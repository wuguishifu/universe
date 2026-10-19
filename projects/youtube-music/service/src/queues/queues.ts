import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type Job, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import {
  BullQueueModule,
  createBullRootOptions,
  type QueueConfig,
  type UniverseJobData,
  type UniverseQueue,
} from '@libs/queue';
import { EnvironmentService } from '../environment/environment';

/** Redis key prefix for youtube-music's queues. */
export const MUSIC_QUEUE_PREFIX = 'youtube-music-queue';

export const MUSIC_QUEUE_CONFIG = {
  /**
   * Downloads one track. The job ID is `track-<id>`, so queueing a track twice queues it once.
   * Everything else is read from the track's row when the job starts.
   */
  download: {
    queueName: 'download',
    jobName: 'download-track',
    jobSchema: z.object({ trackId: z.number() }),
  },
} satisfies Record<string, QueueConfig>;

export type MusicQueueConfig = typeof MUSIC_QUEUE_CONFIG;
export type MusicQueueKey = keyof MusicQueueConfig;
export type MusicJobData<T extends MusicQueueKey> = UniverseJobData<
  MusicQueueConfig,
  T
>;
export type MusicQueue<T extends MusicQueueKey> = UniverseQueue<
  MusicQueueConfig,
  T
>;
export type MusicQueueJob<T extends MusicQueueKey> = Job<MusicJobData<T>>;

export const downloadJobId = (trackId: number) => `track-${trackId}`;

export const MUSIC_JOB_OPTIONS = {
  // Retries cover YouTube hiccups (throttling, "confirm you're not a bot") and S3. Errors that can't
  // get better, like a private video, fail right away.
  download: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  },
} satisfies Record<MusicQueueKey, JobsOptions>;

export const registerQueue = (queueKey: MusicQueueKey) =>
  BullQueueModule.register(
    MUSIC_QUEUE_CONFIG,
    queueKey,
    MUSIC_JOB_OPTIONS[queueKey],
  );

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    return createBullRootOptions(
      this.environmentService.environment.redisUrl,
      MUSIC_QUEUE_PREFIX,
    );
  }
}
