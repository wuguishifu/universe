import { Injectable } from '@nestjs/common';
import type { FlowJobNode, Job } from 'bullmq';

import {
  DEFAULT_QUEUE_CONFIG,
  defineFlowService,
  FlowChildFailedError,
  FlowClient,
  type FlowChildOptions,
  type FlowParentJob,
  type QueueConfigMap,
} from '@libs/queue';
import {
  TRANSCRIPTION_QUEUE_CONFIG,
  TRANSCRIPTION_QUEUE_PREFIX,
  type TranscriptionJobData,
  type TranscriptionJobResult,
} from '@platform/transcription-contracts';

export type TranscriptionRequest = TranscriptionJobData<'transcribe'>;
export type TranscriptionResult = TranscriptionJobResult<'transcribe'>;

/** Options for the transcription job itself (see `FlowChildOptions`). */
export type TranscriptionJobOptions = FlowChildOptions;

/** The app's own job that runs once the transcription finishes, typed by its queue config. */
export type TranscriptionParentJob<
  C extends QueueConfigMap,
  K extends keyof C,
> = FlowParentJob<C, K>;

/** The transcription failed after all attempts and its parent was set to run anyway. */
export class TranscriptionFailedError extends FlowChildFailedError {
  override readonly name = 'TranscriptionFailedError';
}

const transcription = defineFlowService({
  label: 'transcription',
  prefix: TRANSCRIPTION_QUEUE_PREFIX,
  queue: TRANSCRIPTION_QUEUE_CONFIG.transcribe,
  defaultJobOptions: DEFAULT_QUEUE_CONFIG,
  failedError: TranscriptionFailedError,
});

/** Queues transcriptions on the transcription worker as children of the app's own jobs. */
@Injectable()
export class TranscriptionClient {
  constructor(private readonly flows: FlowClient) {}

  /**
   * Transcribes `request`, then runs `parent` in the app's own queue. Read the transcript in the
   * parent's processor with `getResult(job)`.
   *
   * @example
   * await transcription.addFlow({
   *   idempotencyKey: recordingId,
   *   request: { source: { type: 's3', bucket, key } },
   *   parent: {
   *     queueConfig: MY_QUEUE_CONFIG,
   *     queueKey: 'wordDetection',
   *     data: { guildId, userId },
   *   },
   * });
   */
  public async addFlow<C extends QueueConfigMap, K extends keyof C>({
    idempotencyKey,
    request,
    parent,
    jobOptions,
  }: {
    /**
     * Makes adding the flow again a no-op while its jobs are still in Redis (e.g. when the job
     * that adds it retries). Used as both jobs' ID, so it can't contain ':'.
     */
    idempotencyKey?: string;
    request: TranscriptionRequest;
    parent: TranscriptionParentJob<C, K>;
    jobOptions?: Omit<TranscriptionJobOptions, 'jobId'>;
  }): Promise<{ parentJobId: string; transcriptionJobId: string }> {
    const { parentJobId, node } = await this.flows.addFlow({
      idempotencyKey,
      parent,
      children: [this.child(request, jobOptions)],
    });
    const transcriptionJobId = node.children?.[0]?.job.id;
    if (!transcriptionJobId) {
      throw new Error('Flow was added without a transcription job ID');
    }
    return { parentJobId, transcriptionJobId };
  }

  /**
   * Builds the transcription job as a flow child, for flows `addFlow` doesn't cover (e.g. a parent
   * with other children too, or a transcription of another service's output). A parent can have
   * at most one transcription child.
   */
  public child(
    request: TranscriptionRequest,
    options?: TranscriptionJobOptions,
  ): FlowJobNode {
    return transcription.child(request, options);
  }

  /**
   * Reads the transcription result from inside the parent's processor.
   *
   * @throws TranscriptionFailedError if the transcription failed (only with `onFailure: 'run-parent'`).
   */
  public async getResult(parentJob: Job): Promise<TranscriptionResult> {
    return await transcription.getResult(parentJob);
  }
}
