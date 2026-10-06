import { InjectFlowProducer } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type {
  FlowJob,
  FlowNestedLeafJob,
  FlowProducer,
  Job,
  JobsOptions,
} from 'bullmq';
import { z } from 'zod';
import {
  DEFAULT_QUEUE_CONFIG,
  type QueueConfigMap,
  type UniverseJobData,
} from '@libs/queue';
import {
  TRANSCRIPTION_QUEUE_CONFIG,
  TRANSCRIPTION_QUEUE_PREFIX,
  type TranscriptionJobData,
  type TranscriptionJobResult,
} from '@platform/transcription-contracts';
import { TRANSCRIPTION_FLOW_PRODUCER } from './constants';

const QUEUE = TRANSCRIPTION_QUEUE_CONFIG.transcribe;

/** A parent's children values are keyed `<prefix>:<queueName>:<jobId>`. */
const CHILD_KEY_PREFIX = `${TRANSCRIPTION_QUEUE_PREFIX}:${QUEUE.queueName}:`;

export type TranscriptionRequest = TranscriptionJobData<'transcribe'>;
export type TranscriptionResult = TranscriptionJobResult<'transcribe'>;

/**
 * Options for the transcription job itself. The worker can't set these: in a flow, job options
 * come from whoever adds the job, so the defaults live here.
 */
export type TranscriptionJobOptions = Pick<
  JobsOptions,
  | 'jobId'
  | 'attempts'
  | 'backoff'
  | 'priority'
  | 'removeOnComplete'
  | 'removeOnFail'
> & {
  /**
   * What happens to the parent if transcription still fails after all attempts:
   * - `fail-parent` (default): the parent fails without running.
   * - `run-parent`: the parent runs anyway, and `getResult` throws `TranscriptionFailedError`.
   */
  onFailure?: 'fail-parent' | 'run-parent';
};

/** The app's own job that runs once the transcription finishes, typed by its queue config. */
export type TranscriptionParentJob<
  C extends QueueConfigMap,
  K extends keyof C,
> = {
  queueConfig: C;
  queueKey: K;
  data: UniverseJobData<C, K>;
  opts?: NonNullable<FlowJob['opts']>;
  /** Defaults to the app's own Bull prefix (from `BullRootModule`). */
  prefix?: string;
};

/** The transcription failed after all attempts and its parent was set to run anyway. */
export class TranscriptionFailedError extends Error {
  override readonly name = 'TranscriptionFailedError';
}

/** Queues transcriptions on the transcription worker as children of the app's own jobs. */
@Injectable()
export class TranscriptionClient {
  constructor(
    @InjectFlowProducer(TRANSCRIPTION_FLOW_PRODUCER)
    private readonly flowProducer: FlowProducer,
  ) {}

  /**
   * Transcribes `request`, then runs `parent` in the app's own queue. Read the transcript in the
   * parent's processor with `getResult(job)`.
   *
   * @example
   * await transcription.addFlow({
   *   request: { source: { type: 's3', bucket, key } },
   *   parent: {
   *     queueConfig: MY_QUEUE_CONFIG,
   *     queueKey: 'wordDetection',
   *     data: { guildId, userId },
   *   },
   * });
   */
  public async addFlow<C extends QueueConfigMap, K extends keyof C>({
    request,
    parent,
    jobOptions,
  }: {
    request: TranscriptionRequest;
    parent: TranscriptionParentJob<C, K>;
    jobOptions?: TranscriptionJobOptions;
  }): Promise<{ parentJobId: string; transcriptionJobId: string }> {
    const { queueConfig, queueKey, data, opts, prefix } = parent;
    const config = queueConfig[queueKey];
    if (!config) {
      throw new Error(`Unknown queue key: ${String(queueKey)}`);
    }

    const node = await this.flowProducer.add({
      name: config.jobName,
      queueName: config.queueName,
      data: parseOrThrow(config.jobSchema, data, `${config.queueName} job`),
      opts,
      prefix,
      children: [this.child(request, jobOptions)],
    });

    // BullMQ types IDs as optional for jobs not yet added; flow jobs always have one.
    const parentJobId = node.job.id;
    const transcriptionJobId = node.children?.[0]?.job.id;
    if (!parentJobId || !transcriptionJobId) {
      throw new Error('Flow was added without job IDs');
    }
    return { parentJobId, transcriptionJobId };
  }

  /**
   * Builds the transcription job as a flow child, for flows `addFlow` doesn't cover (e.g. a parent
   * with other children too). A parent can have at most one transcription child.
   */
  public child(
    request: TranscriptionRequest,
    { onFailure = 'fail-parent', ...jobOptions }: TranscriptionJobOptions = {},
  ): FlowNestedLeafJob {
    return {
      name: QUEUE.jobName,
      queueName: QUEUE.queueName,
      prefix: TRANSCRIPTION_QUEUE_PREFIX,
      data: parseOrThrow(QUEUE.jobSchema, request, 'transcription request'),
      opts: {
        ...DEFAULT_QUEUE_CONFIG,
        ...jobOptions,
        ...(onFailure === 'fail-parent'
          ? { failParentOnFailure: true }
          : { ignoreDependencyOnFailure: true }),
      },
    };
  }

  /**
   * Reads the transcription result from inside the parent's processor.
   *
   * @throws TranscriptionFailedError if the transcription failed (only with `onFailure: 'run-parent'`).
   */
  public async getResult(parentJob: Job): Promise<TranscriptionResult> {
    const values = Object.entries((await parentJob.getChildrenValues()) ?? {});
    const results = values.filter(([key]) => key.startsWith(CHILD_KEY_PREFIX));
    if (results.length > 1) {
      throw new Error(
        `Job ${parentJob.id} has ${results.length} transcription children; expected one`,
      );
    }
    const [result] = results;
    if (result) {
      return parseOrThrow(
        QUEUE.resultsSchema,
        result[1],
        'transcription result',
      );
    }

    const failures = Object.entries(
      (await parentJob.getIgnoredChildrenFailures()) ?? {},
    );
    const failure = failures.find(([key]) => key.startsWith(CHILD_KEY_PREFIX));
    if (failure) {
      throw new TranscriptionFailedError(failure[1]);
    }
    throw new Error(
      `Job ${parentJob.id} has no transcription result; was it added with TranscriptionClient?`,
    );
  }
}

function parseOrThrow<S extends z.ZodType>(
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
