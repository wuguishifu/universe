import { Job } from 'bullmq';
import z from 'zod';

import {
  UniverseJobData,
  UniverseJobResult,
  UniverseQueue,
  type QueueConfig,
} from '@libs/queue';

import { notificationJobSchema } from './types/notification';

export const NOTIFICATIONS_QUEUE_PREFIX = 'notifications-queue';

/** Expo has receipts ready within ~15 minutes of a send. */
export const RECEIPTS_DELAY_MS = 15 * 60 * 1000;

export const NOTIFICATIONS_QUEUE_CONFIG = {
  send: {
    queueName: 'notifications-send',
    jobName: 'send',
    jobSchema: notificationJobSchema,
  },
  checkReceipts: {
    queueName: 'notifications-receipts',
    jobName: 'check-receipts',
    jobSchema: z.object({
      tickets: z.array(
        z.object({ ticketId: z.string(), expoPushToken: z.string() }),
      ),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type NotificationsQueueConfig = typeof NOTIFICATIONS_QUEUE_CONFIG;
export type NotificationsQueueKey = keyof NotificationsQueueConfig;
export type NotificationsJobData<T extends NotificationsQueueKey> =
  UniverseJobData<NotificationsQueueConfig, T>;
export type NotificationsQueue<T extends NotificationsQueueKey> = UniverseQueue<
  NotificationsQueueConfig,
  T
>;
export type NotificationsJob<T extends NotificationsQueueKey> = Job<
  NotificationsJobData<T>
>;
export type NotificationsJobResult<T extends NotificationsQueueKey> =
  UniverseJobResult<NotificationsQueueConfig, T>;
