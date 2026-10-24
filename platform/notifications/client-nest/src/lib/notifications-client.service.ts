import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  idempotencyKeySchema,
  type Notification,
  notificationJobSchema,
} from '@platform/notifications-contracts';

import { type NotificationsTransportConfig } from './config';
import {
  NOTIFICATION_TRANSPORT,
  NOTIFICATIONS_CLIENT_CONFIG,
} from './constants';
import { type NotificationTransport } from './transports/notification-transport';

export type SendNotificationOptions = {
  /**
   * Makes sending it again a no-op while the job is still in Redis (about an hour after it's sent).
   * Can't contain ':' or be all digits.
   */
  idempotencyKey?: string;
};

/** Sends notifications through notifications-service, over whichever transport the module was set up with. */
@Injectable()
export class NotificationsClient {
  constructor(
    @Inject(NOTIFICATIONS_CLIENT_CONFIG)
    private readonly config: NotificationsTransportConfig<'queue'>,
    @Inject(NOTIFICATION_TRANSPORT)
    private readonly transport: NotificationTransport,
  ) {}

  /**
   * Queues `notification` for every device that hasn't muted its channel.
   *
   * @throws if it couldn't be queued (Redis or notifications-service is unreachable).
   *
   * @example
   * await notifications.send({ channel: 'general', title: 'Backup finished' });
   */
  public async send(
    notification: Notification,
    { idempotencyKey }: SendNotificationOptions = {},
  ): Promise<{ jobId: string }> {
    const data = parseOrThrow(
      notificationJobSchema,
      { ...notification, source: this.config.serviceName },
      'notification',
    );
    const jobId = await this.transport.enqueue(
      data,
      idempotencyKey === undefined
        ? undefined
        : parseOrThrow(idempotencyKeySchema, idempotencyKey, 'idempotencyKey'),
    );
    return { jobId };
  }
}

function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
