import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { UniverseProcessor } from '@libs/queue';
import { api } from '@platform/convex-contracts';
import {
  NOTIFICATIONS_QUEUE_CONFIG,
  type NotificationsJob,
} from '@platform/notifications-contracts';

import { ConvexService } from '../common/convex.service';

import { ExpoPushService } from './expo-push.service';

/**
 * Checks the receipts of a sent notification, about 15 minutes after it was sent. This is where
 * Expo usually reports DeviceNotRegistered (the app was uninstalled), so those devices are removed.
 */
@UniverseProcessor(NOTIFICATIONS_QUEUE_CONFIG, 'checkReceipts')
export class CheckReceiptsProcessor extends WorkerHost {
  private readonly logger = new Logger(CheckReceiptsProcessor.name);

  constructor(
    private readonly convex: ConvexService,
    private readonly expoPushService: ExpoPushService,
  ) {
    super();
  }

  override async process(
    job: NotificationsJob<'checkReceipts'>,
  ): Promise<{ pruned: number }> {
    const tokensByTicket = new Map(
      job.data.tickets.map(({ ticketId, expoPushToken }) => [
        ticketId,
        expoPushToken,
      ]),
    );
    const receipts = await this.expoPushService.getReceipts([
      ...tokensByTicket.keys(),
    ]);

    const unregistered: string[] = [];
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'ok') continue;
      const expoPushToken = tokensByTicket.get(ticketId);
      if (receipt.details?.error === 'DeviceNotRegistered' && expoPushToken) {
        unregistered.push(expoPushToken);
      } else {
        this.logger.warn(
          `Delivery to ${expoPushToken ?? ticketId} failed: ${receipt.message}`,
        );
      }
    }
    if (unregistered.length === 0) {
      return { pruned: 0 };
    }

    const pruned = await this.convex.mutation(
      api.notifications.devices.removeByTokens,
      { expoPushTokens: unregistered },
    );
    this.logger.log(`Removed ${pruned} unregistered device(s)`);
    return { pruned };
  }
}
