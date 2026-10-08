import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  BullQueueModule,
  QueueConfig,
  UniverseJobData,
  UniverseQueue,
} from '@libs/queue';
import { resolveRedisConnection } from '@libs/redis-cache';
import { clipJobDataSchema } from '@projects/clipper-contracts';
import { EnvironmentService } from '../environment/environment';

export const CLIPPER_QUEUE_PREFIX = 'clipper-queue';

export const CLIPPER_QUEUE_CONFIG = {
  processTranscript: {
    queueName: 'process-transcript',
    jobName: 'process-transcript',
    jobSchema: clipJobDataSchema,
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
