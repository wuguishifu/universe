import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { api, type Id } from '@platform/convex-contracts';
import type { ItemSyncResult } from '@projects/finance-contracts';

import { ConvexService } from '../common/convex.service';
import { TokenCipherService } from '../crypto/token-cipher.service';
import {
  formatPlaidError,
  PlaidService,
  plaidErrorCode,
} from '../plaid/plaid.service';

type ItemToSync = {
  userId: Id<'users'>;
  itemId: string;
  institutionName: string | null;
  encryptedAccessToken: string;
};

/** Plaid errors that need the user to log in again through Link (update mode). */
const LOGIN_REQUIRED = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_DISCONNECT']);

/**
 * Copies accounts and balances from Plaid into convex. Uses accounts.get, which returns the
 * balances Plaid last fetched (it refreshes them itself, a few times a day) and is free; the
 * real-time accounts.getBalance is billed per call.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private syncingAll = false;

  constructor(
    private readonly plaidService: PlaidService,
    private readonly convexService: ConvexService,
    private readonly tokenCipher: TokenCipherService,
  ) {}

  /** Every user's items, so balance history builds up without anyone opening the app. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async syncAll(): Promise<void> {
    if (this.syncingAll) return;
    this.syncingAll = true;
    try {
      const items = await this.convexService.query(
        api.finance.sync.listItemsToSync,
        {},
      );
      const results = await this.syncItems(items);
      const failed = results.filter((result) => !result.ok).length;
      this.logger.log(
        `Synced ${results.length - failed}/${results.length} items${failed ? ` (${failed} failed)` : ''}`,
      );
    } catch (error) {
      this.logger.error(`Scheduled sync failed: ${formatPlaidError(error)}`);
    } finally {
      this.syncingAll = false;
    }
  }

  async syncUser(userId: Id<'users'>): Promise<ItemSyncResult[]> {
    const items = await this.convexService.query(
      api.finance.sync.listItemsToSync,
      { userId },
    );
    return this.syncItems(items);
  }

  /** One at a time: there are only a few, and it keeps Plaid's rate limits out of the picture. */
  async syncItems(items: ItemToSync[]): Promise<ItemSyncResult[]> {
    const results: ItemSyncResult[] = [];
    for (const item of items) {
      results.push(await this.syncItem(item));
    }
    return results;
  }

  /** Never throws: failures are logged, recorded on the item when Plaid says why, and returned. */
  async syncItem(item: ItemToSync): Promise<ItemSyncResult> {
    const { userId, itemId, institutionName } = item;
    const result = { itemId, institutionName };

    let accounts;
    try {
      const accessToken = this.tokenCipher.decrypt(
        item.encryptedAccessToken,
        userId,
        itemId,
      );
      ({ accounts } = await this.plaidService.client.accounts.get({
        access_token: accessToken,
      }));
    } catch (error) {
      this.logger.warn(
        `Couldn't sync item ${itemId}: ${formatPlaidError(error)}`,
      );
      const errorCode = plaidErrorCode(error);
      if (!errorCode) return { ...result, ok: false, errorCode: 'SYNC_FAILED' };
      await this.convexService
        .mutation(api.finance.sync.recordSyncError, {
          userId,
          itemId,
          status: LOGIN_REQUIRED.has(errorCode) ? 'login_required' : 'error',
          errorCode,
        })
        .catch((recordError) =>
          this.logger.error(
            `Couldn't record the error on item ${itemId}: ${formatPlaidError(recordError)}`,
          ),
        );
      return { ...result, ok: false, errorCode };
    }

    try {
      await this.convexService.mutation(api.finance.sync.recordAccounts, {
        userId,
        itemId,
        syncedAt: Date.now(),
        accounts: accounts.map((account) => ({
          accountId: account.account_id,
          name: account.name,
          officialName: account.official_name ?? null,
          mask: account.mask ?? null,
          type: account.type,
          subtype: account.subtype ?? null,
          current: account.balances.current ?? null,
          available: account.balances.available ?? null,
          limit: account.balances.limit ?? null,
          isoCurrencyCode: account.balances.iso_currency_code ?? null,
          unofficialCurrencyCode:
            account.balances.unofficial_currency_code ?? null,
        })),
      });
      return { ...result, ok: true };
    } catch (error) {
      this.logger.error(
        `Couldn't save item ${itemId}'s accounts: ${formatPlaidError(error)}`,
      );
      return { ...result, ok: false, errorCode: 'SYNC_FAILED' };
    }
  }
}
