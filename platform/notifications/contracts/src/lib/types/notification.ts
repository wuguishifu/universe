import z from 'zod';

import { NOTIFICATION_CHANNEL_IDS } from '../../channels';

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_IDS);

/** What a caller sends. `source` is filled in by the client from its `serviceName`. */
export type Notification = z.infer<typeof notificationSchema>;
export const notificationSchema = z.object({
  channel: notificationChannelSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  /** Delivered to the app with the notification. */
  data: z.record(z.string(), z.unknown()).optional(),
  /** Opened on tap: a path starting with `/` is an in-app route, anything else opens externally. */
  url: z.string().min(1).optional(),
  priority: z.enum(['default', 'normal', 'high']).optional(),
  /** Deliver without a sound. */
  silent: z.boolean().optional(),
  /**
   * Dropped if it can't be sent within this long (default 1h), both by the service when it's been
   * queued too long and by APNs/FCM when the device is unreachable.
   */
  ttlSeconds: z.number().int().positive().optional(),
  /** A newer notification with the same ID replaces the older one on the device (iOS). */
  collapseId: z.string().min(1).optional(),
});

/** Becomes the BullMQ job ID, so adding the same one again is a no-op while the job is in Redis. */
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .regex(/^(?!\d+$)[^:]+$/, "can't contain ':' or be all digits");

export type NotificationJobData = z.infer<typeof notificationJobSchema>;
export const notificationJobSchema = notificationSchema.extend({
  /** The service that sent it. */
  source: z.string().min(1),
});
