import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, JobsOptions } from 'bullmq';

import {
  BullQueueModule,
  QueueConfig,
  UniverseJobData,
  UniverseQueue,
} from '@libs/queue';
import { resolveRedisConnection } from '@libs/redis-cache';
import {
  clipMetadata,
  preprocessClipJobDataSchema,
} from '@projects/clipper-contracts';
import { EnvironmentService } from '../environment/environment';

export const CLIPPER_QUEUE_PREFIX = 'clipper-queue';

export const CLIPPER_QUEUE_CONFIG = {
  preprocessClip: {
    queueName: 'preprocess-clip',
    jobName: 'preprocess-clip',
    jobSchema: preprocessClipJobDataSchema,
  },
  processTranscripts: {
    queueName: 'process-transcripts',
    jobName: 'process-transcripts',
    jobSchema: clipMetadata.extend({}),
  },
} satisfies Record<string, QueueConfig>;

export type ClipperQueueConfig = typeof CLIPPER_QUEUE_CONFIG;
export type ClipperQueueKey = keyof ClipperQueueConfig;
export type ClipperJobData<T extends ClipperQueueKey> = UniverseJobData<
  ClipperQueueConfig,
  T
>;
export type ClipperQueueJob<T extends ClipperQueueKey> = Job<ClipperJobData<T>>;
export type ClipperQueue<T extends ClipperQueueKey> = UniverseQueue<
  ClipperQueueConfig,
  T
>;

export const CLIPPER_QUEUE_OPTIONS = {
  preprocessClip: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 10 * 60, count: 1000 },
    removeOnFail: { age: 60 * 60, count: 1000 },
  },
  processTranscripts: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 10 * 60, count: 1000 },
    removeOnFail: { age: 60 * 60, count: 1000 },
  },
} satisfies Record<ClipperQueueKey, JobsOptions>;

export const registerQueue = (queue: ClipperQueueKey) =>
  BullQueueModule.register(CLIPPER_QUEUE_CONFIG, queue);

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = resolveRedisConnection(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: 'clipper-queue',
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
