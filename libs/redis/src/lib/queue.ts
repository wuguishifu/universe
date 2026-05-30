import { Job, JobsOptions } from 'bullmq';
import z from 'zod';

export const BULL_QUEUE_PREFIX = 'emerald-queue';

const ONE_MINUTE_MS = 60 * 1000;
const FINISHED_JOB_TTL_SECONDS = 60 * 60;

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

type QueueConfig = {
  queueName: string;
  jobName: string;
  jobSchema: z.ZodObject;
};

/**
 * Each queue should only have a single job due to [concurrency limitations](https://github.com/taskforcesh/bullmq/issues/69#issuecomment-555637737).\
 * Bull allows you to footgun yourself, but BullMQ forces us to do it properly.
 */
export const BULL_QUEUE_CONFIG = {
  bustEntitlementsCache: {
    queueName: 'entitlements-cache-buster-queue',
    jobName: 'bust-cache',
    jobSchema: z.object({
      userId: z.string(),
    }),
  },
} satisfies Record<string, QueueConfig>;

type BullQueueConfig = typeof BULL_QUEUE_CONFIG;

export type JobData<T extends keyof BullQueueConfig> = z.infer<
  BullQueueConfig[T]['jobSchema']
>;

export type QueueJob<T extends keyof BullQueueConfig> = Job<JobData<T>>;
