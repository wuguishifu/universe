import { Injectable } from '@nestjs/common';
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from 'expo-server-sdk';

import { EnvironmentService } from '../../config/environment';

export type ExpoPushTokenMessage = ExpoPushMessage & { to: string };

@Injectable()
export class ExpoPushService {
  private readonly expo: Expo;

  constructor(environmentService: EnvironmentService) {
    this.expo = new Expo({
      accessToken: environmentService.environment.expoAccessToken,
    });
  }

  public isExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  /**
   * Sends each message (one device each) and returns its ticket. Throws if a request to Expo
   * fails; chunks sent before it stay sent.
   */
  public async send(
    messages: ExpoPushTokenMessage[],
  ): Promise<{ expoPushToken: string; ticket: ExpoPushTicket }[]> {
    const results: { expoPushToken: string; ticket: ExpoPushTicket }[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      // Tickets are in the same order as the chunk's messages, which each have a single `to`.
      tickets.forEach((ticket, i) => {
        results.push({ expoPushToken: String(chunk[i]?.to), ticket });
      });
    }
    return results;
  }

  /** Receipts that aren't ready yet (or have expired, after about a day) are left out. */
  public async getReceipts(
    receiptIds: string[],
  ): Promise<Record<string, ExpoPushReceipt>> {
    const receipts: Record<string, ExpoPushReceipt> = {};
    for (const chunk of this.expo.chunkPushNotificationReceiptIds(receiptIds)) {
      Object.assign(
        receipts,
        await this.expo.getPushNotificationReceiptsAsync(chunk),
      );
    }
    return receipts;
  }
}
