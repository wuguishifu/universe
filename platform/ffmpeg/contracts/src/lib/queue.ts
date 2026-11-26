import { Job } from 'bullmq';

import {
  UniverseJobData,
  UniverseJobResult,
  UniverseQueue,
  type QueueConfig,
} from '@libs/queue';

import { ffmpegRequestSchema, ffmpegResultSchema } from './job';

export const FFMPEG_QUEUE_PREFIX = 'ffmpeg-worker-queue';

export const FFMPEG_QUEUE_CONFIG = {
  run: {
    queueName: 'ffmpeg-queue',
    jobName: 'run',
    jobSchema: ffmpegRequestSchema,
    resultsSchema: ffmpegResultSchema,
  },
} satisfies Record<string, QueueConfig>;

export type FfmpegQueueConfig = typeof FFMPEG_QUEUE_CONFIG;
export type FfmpegQueueKey = keyof FfmpegQueueConfig;
export type FfmpegJobData<T extends FfmpegQueueKey> = UniverseJobData<
  FfmpegQueueConfig,
  T
>;
export type FfmpegQueue<T extends FfmpegQueueKey> = UniverseQueue<
  FfmpegQueueConfig,
  T
>;
export type FfmpegJob<T extends FfmpegQueueKey> = Job<FfmpegJobData<T>>;
export type FfmpegJobResult<T extends FfmpegQueueKey> = UniverseJobResult<
  FfmpegQueueConfig,
  T
>;
