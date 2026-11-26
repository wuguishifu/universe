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
  FFMPEG_QUEUE_CONFIG,
  FFMPEG_QUEUE_PREFIX,
  type FfmpegJobData,
  type FfmpegJobResult,
} from '@platform/ffmpeg-contracts';

export type FfmpegRequest = FfmpegJobData<'run'>;
export type FfmpegResult = FfmpegJobResult<'run'>;

/** Options for the ffmpeg job itself (see `FlowChildOptions`). */
export type FfmpegJobOptions = FlowChildOptions;

/** The ffmpeg job failed after all attempts and its parent was set to run anyway. */
export class FfmpegFailedError extends FlowChildFailedError {
  override readonly name = 'FfmpegFailedError';
}

const ffmpeg = defineFlowService({
  label: 'ffmpeg',
  prefix: FFMPEG_QUEUE_PREFIX,
  queue: FFMPEG_QUEUE_CONFIG.run,
  defaultJobOptions: DEFAULT_QUEUE_CONFIG,
  failedError: FfmpegFailedError,
});

/** Queues ffmpeg jobs on the ffmpeg worker (on the Mac mini) as children of the app's own jobs. */
@Injectable()
export class FfmpegClient {
  constructor(private readonly flows: FlowClient) {}

  /**
   * Runs `request`'s ffmpeg steps, then `parent` in the app's own queue. Read the outputs in the
   * parent's processor with `getResult(job)`.
   *
   * @example
   * await ffmpeg.addFlow({
   *   idempotencyKey: clipId,
   *   request: {
   *     inputs: { clip: { type: 's3', bucket, key: `proxies/${clipId}.mp4` } },
   *     outputs: { trimmed: { type: 's3', bucket, key: `clips/${clipId}.mp4` } },
   *     steps: [{
   *       args: ['-ss', '12.5', '-to', '41', '-i', '{{ in:clip }}', '-c:v', 'h264_videotoolbox', '{{ out:trimmed }}'],
   *       expectedDurationMs: 28_500,
   *     }],
   *   },
   *   parent: { queueConfig: MY_QUEUE_CONFIG, queueKey: 'publish', data: { clipId } },
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
    request: FfmpegRequest;
    parent: FlowParentJob<C, K>;
    jobOptions?: Omit<FfmpegJobOptions, 'jobId'>;
  }): Promise<{ parentJobId: string; ffmpegJobId: string }> {
    const { parentJobId, node } = await this.flows.addFlow({
      idempotencyKey,
      parent,
      children: [this.child(request, jobOptions)],
    });
    const ffmpegJobId = node.children?.[0]?.job.id;
    if (!ffmpegJobId) {
      throw new Error('Flow was added without an ffmpeg job ID');
    }
    return { parentJobId, ffmpegJobId };
  }

  /**
   * Builds the ffmpeg job as a flow child, for flows `addFlow` doesn't cover (e.g. as a child of a
   * transcription that reads its output). A parent can have at most one ffmpeg child.
   */
  public child(
    request: FfmpegRequest,
    options?: FfmpegJobOptions,
  ): FlowJobNode {
    return ffmpeg.child(request, options);
  }

  /**
   * Reads the ffmpeg result from inside the parent's processor.
   *
   * @throws FfmpegFailedError if the job failed (only with `onFailure: 'run-parent'`).
   */
  public async getResult(parentJob: Job): Promise<FfmpegResult> {
    return await ffmpeg.getResult(parentJob);
  }
}
