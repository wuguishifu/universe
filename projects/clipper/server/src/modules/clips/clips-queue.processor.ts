import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { setTimeout as sleep } from 'timers/promises';
import { TranscriptionClientService } from '@platform/transcription-client-nest';
import type { Transcript } from '@platform/transcription-contracts';
import { EnvironmentService } from '../../environment/environment';
import { CLIPPER_QUEUE_CONFIG, ClipperQueueJob } from '../../queue/queue';

const TRANSCRIPTION_POLL_INTERVAL_MS = 5_000;
// transcription-service keeps results for an hour, so there's no point waiting longer than that.
const TRANSCRIPTION_TIMEOUT_MS = 60 * 60 * 1000;

// this processor runs in CPU land
@Processor(CLIPPER_QUEUE_CONFIG.processClip.queueName, { concurrency: 1 })
export class ClipsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipsQueueProcessor.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly transcriptionClientService: TranscriptionClientService,
  ) {
    super();
  }

  // BullMQ swallows processing errors (it just retries, then marks the job failed), so log them.
  @OnWorkerEvent('failed')
  onFailed(job: ClipperQueueJob<'processClip'> | undefined, error: Error) {
    // fetch's "fetch failed" hides the real reason (e.g. ECONNREFUSED) in `cause`.
    const reason =
      error.cause instanceof Error
        ? `${error.message}: ${error.cause.message}`
        : error.message;
    this.logger.error(`[${job?.data.key ?? 'unknown'}] ${reason}`);
  }

  override async process(job: ClipperQueueJob<'processClip'>) {
    const { key } = job.data;

    const transcript = await this.transcribe(key);
    this.logger.debug(
      `[${key}] transcribed ${transcript.audioDurationMs}ms into ${transcript.segments.length} segments`,
    );

    // TODO: pick clips from transcript.segments
    return transcript;
  }

  /**
   * `key` points at the clip's audio, already in S3. NOTE: the clipper client doesn't produce this yet; the plan is
   * `ffmpeg -i clip.mp4 -vn -ar 16000 -ac 1 -c:a pcm_s16le clip.wav` (16kHz mono is what whisper resamples to anyway).
   * transcription-service decodes anything ffmpeg can, so a compressed format (e.g. `-c:a libopus -b:a 32k clip.ogg`)
   * works too and uploads ~10x smaller than WAV's ~1.9MB/min.
   *
   * The audio is passed as an S3 source on the batch lane rather than inline: inline is capped at 10MB (~5 minutes of
   * WAV) and the interactive lane is meant for short audio. transcription-service reads the object with its own
   * credentials, so it needs read access to clipper's bucket.
   */
  private async transcribe(key: string): Promise<Transcript> {
    const created = await this.transcriptionClientService.createJob(
      {
        type: 's3',
        bucket: this.environmentService.environment.s3DefaultBucket,
        key,
      },
      // Retries reattach to the original transcription job instead of starting a new one.
      `process-clip:${key}`,
    );
    if (created.status === 400) {
      // A request transcription-service rejects is a configuration problem (e.g. an unknown model).
      throw new UnrecoverableError(
        `transcription-service: ${created.body.message}`,
      );
    }

    const { jobId } = created.body;
    const deadline = Date.now() + TRANSCRIPTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(TRANSCRIPTION_POLL_INTERVAL_MS);

      const response = await this.transcriptionClientService.getJob(jobId);
      if (response.status !== 200) {
        // 404 means the result expired (kept an hour); a retry submits a fresh job under the same idempotency key.
        throw new Error(
          `transcription-service responded ${response.status} for job ${jobId}`,
        );
      }

      const status = response.body;
      switch (status.status) {
        case 'queued':
        case 'processing':
          continue;
        case 'completed':
          return status.transcript;
        case 'failed':
          // The audio couldn't be decoded or transcribed; retrying won't change that.
          throw new UnrecoverableError(
            `transcription-service: ${status.error}`,
          );
      }
    }

    throw new Error(
      `transcription job ${jobId} didn't finish within ${TRANSCRIPTION_TIMEOUT_MS}ms`,
    );
  }
}
