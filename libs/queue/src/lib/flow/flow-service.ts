// Only type imports from this library, so the spec can run this file on Node's type stripping.
import type { FlowJobNode, JobsOptions } from 'bullmq';
import { z } from 'zod';

import type { QueueConfig } from '../common';

/** A queue whose jobs run as flow children: its parents read their results, so it has a schema. */
export type FlowQueueConfig = QueueConfig & { resultsSchema: z.ZodType };

/**
 * Options for a child job. The service's worker can't set these: in a flow, job options come from
 * whoever adds the job, so each service's defaults live in its `defineFlowService` call.
 */
export type FlowChildOptions = Pick<
  JobsOptions,
  | 'jobId'
  | 'attempts'
  | 'backoff'
  | 'priority'
  | 'removeOnComplete'
  | 'removeOnFail'
> & {
  /**
   * What happens to the parent if this job still fails after all attempts:
   * - `fail-parent` (default): the parent fails without running.
   * - `run-parent`: the parent runs anyway, and `getResult` throws the service's
   *   `FlowChildFailedError`.
   */
  onFailure?: 'fail-parent' | 'run-parent';
  /**
   * Jobs that have to finish before this one starts, e.g. an ffmpeg job that writes the S3 object
   * this job reads. This job reads their results with their services' `getResult`.
   */
  children?: FlowJobNode[];
};

/** A flow child failed after all attempts and its parent was set to run anyway. */
export class FlowChildFailedError extends Error {
  override readonly name: string = 'FlowChildFailedError';
  /** The child's key among the parent's dependencies: `<prefix>:<queueName>:<jobId>`. */
  readonly childKey: string;

  constructor(message: string, childKey: string) {
    super(message);
    this.childKey = childKey;
  }
}

export type FlowChildFailedErrorClass = new (
  message: string,
  childKey: string,
) => FlowChildFailedError;

/** A service's job, as a typed flow child, and how its parent reads its result. */
export type FlowService<Q extends FlowQueueConfig> = {
  readonly prefix: string;
  readonly queueName: string;
  /** A parent's children are keyed `<prefix>:<queueName>:<jobId>`; this is all but the ID. */
  readonly childKeyPrefix: string;
  /** Builds the job as a flow child. A parent can have at most one child of each service. */
  child(
    request: z.infer<Q['jobSchema']>,
    options?: FlowChildOptions,
  ): FlowJobNode;
  /**
   * Reads this service's child's result from inside the parent's processor. Only direct children
   * are read: a child that needs its own children's results passes on what its parent needs.
   *
   * @throws the service's `FlowChildFailedError` if the child failed (only with `onFailure: 'run-parent'`).
   */
  getResult(
    parentJob: FlowParentJobHandle,
  ): Promise<z.infer<Q['resultsSchema']>>;
};

/** What `getResult` reads off the parent job; any BullMQ `Job` is one. */
export type FlowParentJobHandle = {
  id?: string;
  getChildrenValues(): Promise<Record<string, unknown>>;
  getIgnoredChildrenFailures(): Promise<Record<string, string>>;
};

/**
 * Defines a service whose jobs run as children of other apps' jobs. Each service's client wraps
 * this, e.g. `TranscriptionClient`.
 */
export function defineFlowService<Q extends FlowQueueConfig>({
  label,
  prefix,
  queue,
  defaultJobOptions,
  failedError = FlowChildFailedError,
}: {
  /** Used in error messages, e.g. "transcription". */
  label: string;
  /** The service worker's Bull prefix. */
  prefix: string;
  /** The queue's entry in the service's queue config, e.g. `TRANSCRIPTION_QUEUE_CONFIG.transcribe`. */
  queue: Q;
  /** The queue's registered `defaultJobOptions` don't apply to jobs added through a flow. */
  defaultJobOptions: Omit<FlowChildOptions, 'jobId' | 'onFailure' | 'children'>;
  /** Thrown by `getResult` for a failed child, so callers can tell services' failures apart. */
  failedError?: FlowChildFailedErrorClass;
}): FlowService<Q> {
  const childKeyPrefix = `${prefix}:${queue.queueName}:`;

  return {
    prefix,
    queueName: queue.queueName,
    childKeyPrefix,

    child(
      request,
      { onFailure = 'fail-parent', children, ...jobOptions } = {},
    ) {
      const node = {
        name: queue.jobName,
        queueName: queue.queueName,
        prefix,
        data: parseOrThrow<Q['jobSchema']>(
          queue.jobSchema,
          request,
          `${label} request`,
        ),
        opts: {
          ...defaultJobOptions,
          ...jobOptions,
          ...(onFailure === 'fail-parent'
            ? { failParentOnFailure: true }
            : { ignoreDependencyOnFailure: true }),
        },
      };
      return children?.length ? { ...node, children } : node;
    },

    async getResult(parentJob) {
      const values = Object.entries(
        (await parentJob.getChildrenValues()) ?? {},
      );
      const results = values.filter(([key]) => key.startsWith(childKeyPrefix));
      if (results.length > 1) {
        throw new Error(
          `Job ${parentJob.id} has ${results.length} ${label} children; expected one`,
        );
      }
      const [result] = results;
      if (result) {
        return parseOrThrow<Q['resultsSchema']>(
          queue.resultsSchema,
          result[1],
          `${label} result`,
        );
      }

      const failures = Object.entries(
        (await parentJob.getIgnoredChildrenFailures()) ?? {},
      );
      const failure = failures.find(([key]) => key.startsWith(childKeyPrefix));
      if (failure) {
        throw new failedError(failure[1], failure[0]);
      }
      throw new Error(
        `Job ${parentJob.id} has no ${label} result; was its ${label} job added as its child?`,
      );
    },
  };
}

export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
