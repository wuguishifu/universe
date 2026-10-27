import 'server-only';

import { z } from 'zod';

import { randomUUID } from 'crypto';

import { HttpService } from '@libs/http';
import {
  idempotencyKeySchema,
  type Notification,
  notificationJobSchema,
} from '@platform/notifications-contracts';

import { type NotificationsClientConfig } from './config';

export type SendNotificationOptions = {
  /**
   * Makes sending it again a no-op while the job is still in Redis (about an hour after it's sent).
   * Can't contain ':' or be all digits.
   */
  idempotencyKey?: string;
};

/**
 * Sends notifications by POSTing to notifications-service. Server-only (it holds the API token), and
 * needs the Node.js runtime.
 *
 * Pass the config as a function to read it on the first send instead of at import: `next build`
 * imports route modules to collect page data, usually without the service's env vars set.
 *
 * @example
 * export const notifications = new NotificationsClient(() => ({
 *   serviceName: 'sapphire-web',
 *   baseUrl: env.NOTIFICATIONS_SERVICE_URL,
 *   apiToken: env.NOTIFICATIONS_SERVICE_API_TOKEN,
 * }));
 */
export class NotificationsClient {
  private resolved?: { serviceName: string; httpService: HttpService };

  constructor(
    private readonly config:
      | NotificationsClientConfig
      | (() => NotificationsClientConfig),
  ) {}

  /**
   * Queues `notification` for every device that hasn't muted its channel.
   *
   * @throws if it couldn't be queued (notifications-service is unreachable).
   *
   * @example
   * await notifications.send({ channel: 'general', title: 'Backup finished' });
   */
  public async send(
    notification: Notification,
    // Always sent, so a retried request whose first attempt did get through isn't queued twice.
    { idempotencyKey = randomUUID() }: SendNotificationOptions = {},
  ): Promise<{ jobId: string }> {
    const { serviceName, httpService } = this.resolve();
    const data = parseOrThrow(
      notificationJobSchema,
      { ...notification, source: serviceName },
      'notification',
    );
    const response = await httpService.post<{ jobId: string }>(
      '/notifications',
      {
        ...data,
        idempotencyKey: parseOrThrow(
          idempotencyKeySchema,
          idempotencyKey,
          'idempotencyKey',
        ),
      },
    );
    return { jobId: response.data.jobId };
  }

  private resolve(): { serviceName: string; httpService: HttpService } {
    if (!this.resolved) {
      const { serviceName, baseUrl, apiToken } =
        typeof this.config === 'function' ? this.config() : this.config;
      this.resolved = {
        serviceName,
        // Retries network errors and 5xx/429 with exponential backoff.
        httpService: new HttpService({
          baseURL: `${baseUrl}/api`,
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        }),
      };
    }
    return this.resolved;
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
