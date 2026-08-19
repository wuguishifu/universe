import { Job } from 'bullmq';
import z from 'zod';
import { QueueConfig, UniverseJobData, UniverseQueue } from '../common.js';

export const SILVER_QUEUE_CONFIG = {
  youtubeConverter: {
    queueName: 'youtube-converter',
    jobName: 'convert-youtube-video',
    jobSchema: z.object({
      url: z.url(),
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
