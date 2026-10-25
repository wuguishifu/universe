import { WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';

import { UniverseProcessor } from '@libs/queue';
import { api } from '@platform/convex-contracts';
import {
  NOTIFICATIONS_QUEUE_CONFIG,
  type NotificationsJob,
  type NotificationsQueue,
  RECEIPTS_DELAY_MS,
} from '@platform/notifications-contracts';

import { ConvexService } from '../common/convex.service';

import {
  ExpoPushService,
  type ExpoPushTokenMessage,
} from './expo-push.service';

const DEFAULT_TTL_SECONDS = 60 * 60;

type SendResult = {
  devices: number;
  sent: number;
  failed: number;
  pruned: number;
};

/**
 * Sends a notification to every device that hasn't muted its channel.
 *
 * Only a failed request to Expo throws (and so retries the job). Once Expo has the messages, errors
 * after that are logged rather than thrown, so a retry never sends the notification twice.
 */
@UniverseProcessor(NOTIFICATIONS_QUEUE_CONFIG, 'send', { concurrency: 4 })
export class SendNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(SendNotificationProcessor.name);

  constructor(
    private readonly convex: ConvexService,
    private readonly expoPushService: ExpoPushService,
    @Inject(NOTIFICATIONS_QUEUE_CONFIG.checkReceipts.queueName)
    private readonly receiptsQueue: NotificationsQueue<'checkReceipts'>,
  ) {
    super();
  }

  override async process(job: NotificationsJob<'send'>): Promise<SendResult> {
    const {
      channel,
      title,
      body,
      data,
      url,
      priority,
      silent,
      ttlSeconds = DEFAULT_TTL_SECONDS,
      collapseId,
      source,
    } = job.data;
    const result: SendResult = { devices: 0, sent: 0, failed: 0, pruned: 0 };

    // Counted from when the job was first added, so retries and an outage don't extend it.
    const remainingSeconds = Math.floor(
      (job.timestamp + ttlSeconds * 1000 - Date.now()) / 1000,
    );
    if (remainingSeconds <= 0) {
      this.logger.warn(
        `Dropping "${title}" from ${source}: it expired before it could be sent`,
      );
      return result;
    }

    const tokens = await this.convex.query(
      api.notifications.devices.listTokensForChannel,
      { channel },
    );
    const validTokens = tokens.filter((token) => {
      const valid = this.expoPushService.isExpoPushToken(token);
      if (!valid) this.logger.warn(`Skipping invalid Expo push token ${token}`);
      return valid;
    });
    result.devices = validTokens.length;
    if (validTokens.length === 0) {
      this.logger.debug(`No devices for "${title}" on ${channel}`);
      return result;
    }

    const messages = validTokens.map((to): ExpoPushTokenMessage => ({
      to,
      title,
      body,
      data: { ...data, channel, source, url },
      priority,
      sound: silent ? null : 'default',
      ttl: remainingSeconds,
      channelId: channel,
      collapseId,
    }));
    const results = await this.expoPushService.send(messages);

    const receipts: { ticketId: string; expoPushToken: string }[] = [];
    const unregistered: string[] = [];
    for (const { expoPushToken, ticket } of results) {
      if (ticket.status === 'ok') {
        result.sent++;
        receipts.push({ ticketId: ticket.id, expoPushToken });
        continue;
      }
      result.failed++;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        unregistered.push(expoPushToken);
      } else {
        this.logger.warn(
          `Expo rejected "${title}" for ${expoPushToken}: ${ticket.message}`,
        );
      }
    }
    this.logger.log(
      `Sent "${title}" to ${result.sent}/${validTokens.length} device(s)` +
        (receipts.length > 0
          ? `, tickets: ${receipts.map(({ ticketId }) => ticketId).join(', ')}`
          : ''),
    );

    // Neither of these throws: a failure here would retry the job and send it again. A device that
    // isn't pruned now is pruned on the next notification that hits it.
    if (unregistered.length > 0) {
      result.pruned = await this.removeDevices(unregistered);
    }
    if (receipts.length > 0) {
      await this.receiptsQueue
        .add(
          NOTIFICATIONS_QUEUE_CONFIG.checkReceipts.jobName,
          { tickets: receipts },
          { delay: RECEIPTS_DELAY_MS },
        )
        .catch((error: unknown) => {
          this.logger.warn(`Failed to queue the receipts check: ${error}`);
        });
    }

    return result;
  }

  private async removeDevices(expoPushTokens: string[]): Promise<number> {
    try {
      const removed = await this.convex.mutation(
        api.notifications.devices.removeByTokens,
        { expoPushTokens },
      );
      this.logger.log(`Removed ${removed} unregistered device(s)`);
      return removed;
    } catch (error) {
      this.logger.warn(`Failed to remove unregistered devices: ${error}`);
      return 0;
    }
  }
}
