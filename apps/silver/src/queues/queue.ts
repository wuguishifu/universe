import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, type JobsOptions } from 'bullmq';
import z from 'zod';
import {
  BullQueueModule,
  QueueConfig,
  resolveRedisConnection,
  UniverseJobData,
  UniverseQueue,
} from '@universe/queue';
import { EnvironmentService } from '../environment/environment-service';

export const SILVER_QUEUE_CONFIG = {
  youtubeConverter: {
    queueName: 'youtube-converter',
    jobName: 'convert-youtube-video',
    jobSchema: z.object({
      videoId: z.string(),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type SilverQueueConfig = typeof SILVER_QUEUE_CONFIG;
export type SilverQueueKey = keyof SilverQueueConfig;

export type SilverJobData<T extends SilverQueueKey> = UniverseJobData<
  SilverQueueConfig,
  T
>;

export type SilverQueue<T extends SilverQueueKey> = UniverseQueue<
  SilverQueueConfig,
  T
>;

export type SilverQueueJob<T extends SilverQueueKey> = Job<SilverJobData<T>>;

export const registerQueue = <T extends SilverQueueKey>(
  queueKey: T,
  defaultJobOptions?: JobsOptions,
) => BullQueueModule.register(SILVER_QUEUE_CONFIG, queueKey, defaultJobOptions);

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = resolveRedisConnection(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: 'silver-queue',
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
