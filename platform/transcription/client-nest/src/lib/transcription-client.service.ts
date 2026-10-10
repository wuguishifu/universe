import { InjectFlowProducer } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type {
  FlowNestedLeafJob,
  FlowProducer,
  FlowRootParentJob,
  Job,
  JobsOptions,
} from 'bullmq';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
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
import {
  TRANSCRIPTION_CLIENT_CONFIG,
  TRANSCRIPTION_FLOW_PRODUCER,
} from './constants';

const QUEUE = TRANSCRIPTION_QUEUE_CONFIG.transcribe;

/** A parent's children values are keyed `<prefix>:<queueName>:<jobId>`. */
const CHILD_KEY_PREFIX = `${TRANSCRIPTION_QUEUE_PREFIX}:${QUEUE.queueName}:`;

/** Transcription job IDs are `<parentJobId><separator><key>`, so `getResults` can recover the key. */
const CHILD_ID_SEPARATOR = '.';

export type TranscriptionRequest = TranscriptionJobData<'transcribe'>;
export type TranscriptionResult = TranscriptionJobResult<'transcribe'>;

/** One transcription's outcome, shaped like `Promise.allSettled`'s results. */
export type TranscriptionOutcome =
  | { status: 'fulfilled'; value: TranscriptionResult }
  | { status: 'rejected'; reason: TranscriptionFailedError };

/**
 * Options for the transcription jobs themselves. The worker can't set these: in a flow, job
 * options come from whoever adds the job, so the defaults live here.
 */
export type TranscriptionJobOptions = Pick<
  JobsOptions,
  'attempts' | 'backoff' | 'priority' | 'removeOnComplete' | 'removeOnFail'
> & {
  /**
   * What happens to the parent if a transcription still fails after all attempts:
   * - `fail-parent` (default): the parent fails without running.
   * - `run-parent`: the parent runs once the other transcriptions finish, and the failed one's
   *   outcome is `rejected`.
   */
  onFailure?: 'fail-parent' | 'run-parent';
};

/** The app's own job that runs once every transcription finishes, typed by its queue config. */
export type TranscriptionParentJob<
  C extends QueueConfigMap,
  K extends keyof C,
> = {
  queueKey: K;
  data: UniverseJobData<C, K>;
  /**
   * The queue's registered `defaultJobOptions` don't apply to jobs added through a flow, so pass
   * them here. Set the parent's ID with `idempotencyKey`, which also dedupes the transcriptions.
   */
  opts?: Omit<NonNullable<FlowRootParentJob['opts']>, 'jobId'>;
  /** Defaults to the app's own Bull prefix (from `BullRootModule`). */
  prefix?: string;
};

export type TranscriptionFlow<C extends QueueConfigMap, K extends keyof C> = {
  /**
   * Makes adding the flow again a no-op while its jobs are still in Redis (e.g. when the job that
   * adds it retries). Becomes the parent's ID, and prefixes the transcriptions' IDs, so it can't
   * contain ':'.
   */
  idempotencyKey?: string;
  /**
   * The transcriptions to run before the parent, keyed by a name of your choosing (e.g. a speaker
   * ID for multi-track audio). Read each one back by its key with `getResult`/`getResults`. Keys
   * can't contain ':'.
   */
  requests: Record<string, TranscriptionRequest>;
  parent: TranscriptionParentJob<C, K>;
  /** Applies to every transcription in the flow. */
  jobOptions?: TranscriptionJobOptions;
};

/** A flow as `buildFlow` returns it: the parent's ID is always set. */
export type TranscriptionFlowJob = FlowRootParentJob & {
  opts: { jobId: string };
  children: FlowNestedLeafJob[];
};

export type AddedTranscriptionFlow = {
  parentJobId: string;
  /** Keyed like the flow's `requests`. */
  transcriptionJobIds: Record<string, string>;
};

/** The transcription failed after all attempts and its parent was set to run anyway. */
export class TranscriptionFailedError extends Error {
  override readonly name = 'TranscriptionFailedError';
}

/** Queues transcriptions on the transcription worker as children of the app's own jobs. */
@Injectable()
export class TranscriptionClient<C extends QueueConfigMap> {
  constructor(
    @InjectFlowProducer(TRANSCRIPTION_FLOW_PRODUCER)
    private readonly flowProducer: FlowProducer,
    @Inject(TRANSCRIPTION_CLIENT_CONFIG)
    private readonly queueConfig: C,
  ) {}

  /**
   * Runs every transcription in `requests`, then runs `parent` in the app's own queue. Read the
   * transcripts in the parent's processor with `getResult(job, key)` or `getResults(job)`.
   *
   * @example
   * await transcription.addFlow({
   *   idempotencyKey: recordingId,
   *   requests: {
   *     [aliceId]: { source: { type: 's3', bucket, key: aliceTrackKey } },
   *     [bobId]: { source: { type: 's3', bucket, key: bobTrackKey } },
   *   },
   *   parent: { queueKey: 'wordDetection', data: { guildId, recordingId } },
   * });
   */
  public async addFlow<K extends keyof C>(
    flow: TranscriptionFlow<C, K>,
  ): Promise<AddedTranscriptionFlow> {
    const job = this.buildFlow(flow);
    await this.flowProducer.add(job);
    return addedFlow(job);
  }

  /** `addFlow` for several flows at once, added atomically. */
  public async addFlows<K extends keyof C>(
    flows: TranscriptionFlow<C, K>[],
  ): Promise<AddedTranscriptionFlow[]> {
    const jobs = flows.map((flow) => this.buildFlow(flow));
    await this.flowProducer.addBulk(jobs);
    return jobs.map(addedFlow);
  }

  /**
   * Builds the flow `addFlow` would add, for flows it doesn't cover (e.g. a parent with other
   * children too). Add other children alongside `children`, keeping the parent's `opts.jobId`.
   */
  public buildFlow<K extends keyof C>({
    idempotencyKey,
    requests,
    parent: { queueKey, data, opts, prefix },
    jobOptions,
  }: TranscriptionFlow<C, K>): TranscriptionFlowJob {
    const config = this.queueConfig[queueKey];
    if (!config) {
      throw new Error(`Unknown queue key: ${String(queueKey)}`);
    }
    const entries = Object.entries(requests);
    if (entries.length === 0) {
      throw new Error('A transcription flow needs at least one request');
    }

    // The transcriptions' IDs are derived from the parent's, so it's always fixed. They have to
    // be: with only the parent's, BullMQ attaches a second set of transcriptions.
    const parentJobId = idempotencyKey ?? randomUUID();
    assertIdPart(parentJobId, 'idempotencyKey');

    return {
      name: config.jobName,
      queueName: config.queueName,
      data: parseOrThrow(config.jobSchema, data, `${config.queueName} job`),
      opts: { ...opts, jobId: parentJobId },
      prefix,
      children: entries.map(([key, request]) => {
        assertIdPart(key, 'request key');
        return this.child(childJobId(parentJobId, key), request, jobOptions);
      }),
    };
  }

  /**
   * Reads one transcription's result from inside the parent's processor.
   *
   * @throws TranscriptionFailedError if that transcription failed (only with
   * `onFailure: 'run-parent'`).
   */
  public async getResult(
    parentJob: Job,
    key: string,
  ): Promise<TranscriptionResult> {
    const outcome = (await this.getResults(parentJob))[key];
    if (!outcome) {
      throw new Error(`Job ${parentJob.id} has no transcription '${key}'`);
    }
    if (outcome.status === 'rejected') throw outcome.reason;
    return outcome.value;
  }

  /**
   * Reads every transcription's outcome from inside the parent's processor, keyed like the flow's
   * `requests`. Outcomes are only `rejected` with `onFailure: 'run-parent'`.
   */
  public async getResults(
    parentJob: Job,
  ): Promise<Record<string, TranscriptionOutcome>> {
    const keyPrefix = `${CHILD_KEY_PREFIX}${parentJob.id}${CHILD_ID_SEPARATOR}`;
    const [values, failures] = await Promise.all([
      parentJob.getChildrenValues(),
      parentJob.getIgnoredChildrenFailures(),
    ]);

    const outcomes: Record<string, TranscriptionOutcome> = {};
    for (const [childKey, value] of Object.entries(values ?? {})) {
      if (!childKey.startsWith(keyPrefix)) continue;
      outcomes[childKey.slice(keyPrefix.length)] = {
        status: 'fulfilled',
        value: parseOrThrow(QUEUE.resultsSchema, value, 'transcription result'),
      };
    }
    for (const [childKey, reason] of Object.entries(failures ?? {})) {
      if (!childKey.startsWith(keyPrefix)) continue;
      outcomes[childKey.slice(keyPrefix.length)] = {
        status: 'rejected',
        reason: new TranscriptionFailedError(reason),
      };
    }

    if (Object.keys(outcomes).length === 0) {
      throw new Error(
        `Job ${parentJob.id} has no transcription results; was it added with TranscriptionClient?`,
      );
    }
    return outcomes;
  }

  private child(
    jobId: string,
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
        jobId,
        ...(onFailure === 'fail-parent'
          ? { failParentOnFailure: true }
          : { ignoreDependencyOnFailure: true }),
      },
    };
  }
}

function childJobId(parentJobId: string, key: string): string {
  return `${parentJobId}${CHILD_ID_SEPARATOR}${key}`;
}

function addedFlow({
  opts: { jobId: parentJobId },
  children,
}: TranscriptionFlowJob): AddedTranscriptionFlow {
  const prefix = `${parentJobId}${CHILD_ID_SEPARATOR}`;
  const transcriptionJobIds: Record<string, string> = {};
  for (const child of children) {
    const jobId = child.opts?.jobId;
    if (jobId) transcriptionJobIds[jobId.slice(prefix.length)] = jobId;
  }
  return { parentJobId, transcriptionJobIds };
}

/** BullMQ rejects job IDs containing ':', its key separator. */
function assertIdPart(value: string, label: string) {
  if (!value || value.includes(':')) {
    throw new Error(
      `Invalid ${label} '${value}': must be non-empty without ':'`,
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
    throw new Error(`Invalid ${label}:\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
