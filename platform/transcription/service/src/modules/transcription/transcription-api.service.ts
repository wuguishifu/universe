import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { createHash } from 'crypto';
import { S3Service } from '@universe/nest-common';
import {
  type Transcript,
  type TranscriptionJobStatus,
  type TranscriptionRequest,
  transcriptSchema,
} from '@universe/platform/transcription/contracts';
import {
  TUNGSTEN_QUEUE_CONFIG,
  type TranscriptionJob,
  type TranscriptionLane,
  type TranscriptionQueue,
} from '../../queues/queue';
import { WhisperModelsService } from './whisper-models.service';

/** How long `POST /transcriptions` holds the request open before answering 504. */
const SYNC_WAIT_MS = 60_000;

/** The request can't be served as sent (400). */
export class InvalidTranscriptionRequestError extends Error {}
/** The job ran and failed; retrying the same request won't help (422). */
export class TranscriptionFailedError extends Error {}
/** The job is still queued or running (504). Safe to retry with the same idempotency key. */
export class TranscriptionTimeoutError extends Error {}

/** API-side: validates requests, queues them on the right lane, and reports results. */
@Injectable()
export class TranscriptionApiService implements OnModuleInit, OnModuleDestroy {
  private readonly queues: Record<TranscriptionLane, TranscriptionQueue>;
  /** Listens for interactive job completions so sync requests can wait on them. */
  private interactiveEvents!: QueueEvents;

  constructor(
    @Inject(TUNGSTEN_QUEUE_CONFIG.interactive.queueName)
    interactiveQueue: TranscriptionQueue,
    @Inject(TUNGSTEN_QUEUE_CONFIG.batch.queueName)
    batchQueue: TranscriptionQueue,
    private readonly models: WhisperModelsService,
    private readonly s3: S3Service,
  ) {
    this.queues = { interactive: interactiveQueue, batch: batchQueue };
  }

  onModuleInit() {
    const { name, opts } = this.queues.interactive;
    this.interactiveEvents = new QueueEvents(name, {
      connection: opts.connection,
      prefix: opts.prefix,
    });
  }

  async onModuleDestroy() {
    await this.interactiveEvents.close();
  }

  /** Queues on the interactive lane and waits for the transcript. */
  async transcribe(
    request: TranscriptionRequest,
    idempotencyKey: string | undefined,
  ): Promise<Transcript> {
    const job = await this.submit('interactive', request, idempotencyKey);
    const jobId = requireJobId(job);
    try {
      return transcriptSchema.parse(
        await job.waitUntilFinished(this.interactiveEvents, SYNC_WAIT_MS),
      );
    } catch {
      // waitUntilFinished rejects both on failure and on timeout; the job state tells them apart.
      const latest = await this.queues.interactive.getJob(jobId);
      if (latest && (await latest.isFailed())) {
        throw new TranscriptionFailedError(
          latest.failedReason || 'Transcription failed',
        );
      }
      throw new TranscriptionTimeoutError(
        `Transcription did not finish within ${SYNC_WAIT_MS}ms`,
      );
    }
  }

  /** Queues on the batch lane and returns the job ID to poll. */
  async createJob(
    request: TranscriptionRequest,
    idempotencyKey: string | undefined,
  ): Promise<string> {
    const job = await this.submit('batch', request, idempotencyKey);
    return requireJobId(job);
  }

  async getJobStatus(jobId: string): Promise<TranscriptionJobStatus | null> {
    const job = await this.queues.batch.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    switch (state) {
      case 'completed':
        return {
          jobId,
          status: 'completed',
          transcript: transcriptSchema.parse(job.returnvalue),
        };
      case 'failed':
        return {
          jobId,
          status: 'failed',
          error: job.failedReason || 'Transcription failed',
        };
      case 'active':
        return { jobId, status: 'processing' };
      default:
        // waiting, prioritized, delayed (between retries), waiting-children, unknown
        return { jobId, status: 'queued' };
    }
  }

  listModels() {
    return {
      defaultModel: this.models.defaultModel,
      models: this.models.models,
      vadAvailable: Boolean(this.models.vadModelPath),
    };
  }

  private async submit(
    lane: TranscriptionLane,
    request: TranscriptionRequest,
    idempotencyKey: string | undefined,
  ): Promise<TranscriptionJob> {
    const model = this.models.resolve(request.options.model);
    if (!model) {
      throw new InvalidTranscriptionRequestError(
        `Unknown model "${request.options.model}". Available: ${this.models.models.join(', ')}`,
      );
    }
    if (request.options.vad && !this.models.vadModelPath) {
      throw new InvalidTranscriptionRequestError('VAD is not available');
    }
    if (request.source.type === 's3' && !this.s3.isConfigured) {
      throw new InvalidTranscriptionRequestError(
        'S3 sources are not configured',
      );
    }

    const queue = this.queues[lane];
    // BullMQ job IDs can't be integers or contain ':', so hash the caller's key.
    const jobId = idempotencyKey
      ? createHash('sha256').update(`${lane}\0${idempotencyKey}`).digest('hex')
      : undefined;

    if (jobId) {
      const existing = await queue.getJob(jobId);
      if (existing) {
        // Same key as an earlier request: attach to that job instead of transcribing again.
        // A failed one is re-run, since the caller retrying means they still want a result.
        if (await existing.isFailed()) await existing.retry('failed');
        return existing;
      }
    }

    // Pin the resolved model so the job doesn't depend on the worker's default.
    return queue.add(
      TUNGSTEN_QUEUE_CONFIG[lane].jobName,
      { ...request, options: { ...request.options, model } },
      { jobId },
    );
  }
}

function requireJobId(job: TranscriptionJob): string {
  // Always set once a job is added; BullMQ types it as optional for jobs not yet added.
  if (!job.id) throw new Error('Queued job has no ID');
  return job.id;
}
