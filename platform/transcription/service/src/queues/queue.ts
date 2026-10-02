import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type Job, type JobsOptions } from 'bullmq';
import {
  BullQueueModule,
  DEFAULT_QUEUE_CONFIG,
  FINISHED_JOB_TTL_SECONDS,
  type QueueConfig,
  type UniverseJobData,
  type UniverseQueue,
} from '@libs/queue';
import { resolveRedisConnection } from '@libs/redis-cache';
import { transcriptionRequestSchema } from '@platform/transcription-contracts';
import { EnvironmentService } from '../environment/environment-service';

/**
 * transcription-service's queues are an internal detail: callers go through the HTTP contract and never
 * touch these. That's why this config lives in the app rather than in @libs/queue.
 *
 * Each lane is a separate queue with its own worker, so a long batch job can never delay
 * an interactive one (BullMQ priorities only reorder waiting jobs; they can't preempt).
 */
export const TRANSCRIPTION_SERVICE_QUEUE_CONFIG = {
  interactive: {
    queueName: 'transcription-interactive',
    jobName: 'transcribe',
    jobSchema: transcriptionRequestSchema,
  },
  batch: {
    queueName: 'transcription-batch',
    jobName: 'transcribe',
    jobSchema: transcriptionRequestSchema,
  },
} satisfies Record<string, QueueConfig>;

export type TranscriptionServiceQueueConfig =
  typeof TRANSCRIPTION_SERVICE_QUEUE_CONFIG;
export type TranscriptionLane = keyof TranscriptionServiceQueueConfig;
export type TranscriptionJobData = UniverseJobData<
  TranscriptionServiceQueueConfig,
  TranscriptionLane
>;
export type TranscriptionQueue = UniverseQueue<
  TranscriptionServiceQueueConfig,
  TranscriptionLane
>;
export type TranscriptionJob = Job<TranscriptionJobData>;

const LANE_JOB_OPTIONS: Record<TranscriptionLane, JobsOptions> = {
  // The caller is waiting on the HTTP response and owns retries. Jobs only need to outlive
  // a retry with the same idempotency key, and they hold inline audio, so don't keep them long.
  interactive: {
    attempts: 1,
    removeOnComplete: { age: 5 * 60, count: 500 },
    removeOnFail: { age: 5 * 60, count: 500 },
  },
  // Retries cover transient S3/network failures. Results are polled, so keep them an hour.
  batch: {
    ...DEFAULT_QUEUE_CONFIG,
    removeOnComplete: { age: FINISHED_JOB_TTL_SECONDS },
    removeOnFail: { age: FINISHED_JOB_TTL_SECONDS },
  },
};

export const registerQueue = (lane: TranscriptionLane) =>
  BullQueueModule.register(
    TRANSCRIPTION_SERVICE_QUEUE_CONFIG,
    lane,
    LANE_JOB_OPTIONS[lane],
  );

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = resolveRedisConnection(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: 'transcription-service-queue',
      connection: {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        family: connection.family,
      },
    };
  }
}
