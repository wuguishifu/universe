import { JobsOptions, Queue } from 'bullmq';
import { z } from 'zod';

export const ONE_MINUTE_MS = 60 * 1000;
export const FINISHED_JOB_TTL_SECONDS = 60 * 60;
export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export const DEFAULT_QUEUE_CONFIG: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: ONE_MINUTE_MS,
  },
  removeOnComplete: {
    age: FINISHED_JOB_TTL_SECONDS,
    count: 1000,
  },
  removeOnFail: {
    age: FINISHED_JOB_TTL_SECONDS,
    count: 1000,
  },
};

export type QueueConfig = {
  queueName: string;
  jobName: string;
  jobSchema: z.ZodType;
};

export type QueueConfigMap = Record<string, QueueConfig>;

export type UniverseJobData<
  C extends QueueConfigMap,
  T extends keyof C,
> = z.infer<C[T]['jobSchema']>;

export type UniverseQueue<C extends QueueConfigMap, T extends keyof C> = Queue<
  UniverseJobData<C, T>,
  unknown,
  C[T]['jobName']
>;
