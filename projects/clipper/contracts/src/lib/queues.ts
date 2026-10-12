import { type Job, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import {
  type QueueConfig,
  type UniverseJobData,
  type UniverseQueue,
} from '@libs/queue';

/** Redis key prefix for clipper's queues. */
export const CLIPPER_QUEUE_PREFIX = 'clipper-queue';

export const CLIPPER_QUEUE_CONFIG = {
  /**
   * One clip in one run, to send to Gemini. The job ID is the clip job's Convex ID, so adding the
   * same one twice queues it once. Everything else (the clip, the run's options) is read from
   * Convex when the job starts, so a cancelled run's jobs see it.
   */
  analyze: {
    queueName: 'analyze',
    jobName: 'analyze-clip',
    jobSchema: z.object({
      clipJobId: z.string(),
      runId: z.string(),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type ClipperQueueConfig = typeof CLIPPER_QUEUE_CONFIG;
export type ClipperQueueKey = keyof ClipperQueueConfig;
export type ClipperJobData<T extends ClipperQueueKey> = UniverseJobData<
  ClipperQueueConfig,
  T
>;
export type ClipperQueue<T extends ClipperQueueKey> = UniverseQueue<
  ClipperQueueConfig,
  T
>;
export type ClipperQueueJob<T extends ClipperQueueKey> = Job<ClipperJobData<T>>;

/** BullMQ priorities: lower runs first. */
export const CLIPPER_PRIORITY = { auto: 1, manual: 10 } as const;

export const CLIPPER_JOB_OPTIONS = {
  // Retries cover Gemini rate limits and outages, S3 and Convex. Invalid answers are retried in the
  // same attempt (see AnalyzeClipProcessor), and errors that can't get better fail right away.
  analyze: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  },
} satisfies Record<ClipperQueueKey, JobsOptions>;
