import { type NotificationJobData } from '@platform/notifications-contracts';

export interface NotificationTransport {
  /** Gets the notification onto notifications-service's queue and returns its job ID. */
  enqueue(data: NotificationJobData, idempotencyKey?: string): Promise<string>;
}
