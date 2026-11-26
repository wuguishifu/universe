import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx, query } from '../_generated/server';

import { assertFinanceSecret, financeSecret } from './auth';
import { syncedAccount } from './validators';

// MARK: finance-service

/**
 * Items for finance-service to sync, with their encrypted tokens: one user's (the web app's
 * Refresh button), or everyone's (the scheduled sync).
 */
export const listItemsToSync = query({
  args: { secret: financeSecret, userId: v.optional(v.id('users')) },
  handler: async (ctx, { secret, userId }) => {
    assertFinanceSecret(secret);
    const items = userId
      ? await ctx.db
          .query('financeItems')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .collect()
      : await ctx.db.query('financeItems').collect();
    return items.map((item) => ({
      userId: item.userId,
      itemId: item.itemId,
      institutionName: item.institutionName,
      encryptedAccessToken: item.encryptedAccessToken,
    }));
  },
});

/**
 * Saves an item's accounts from accounts.get, replacing the last sync's: accounts Plaid no longer
 * returns are deleted (their snapshots stay). Also records today's snapshot of each balance and
 * marks the item healthy.
 */
export const recordAccounts = mutation({
  args: {
    secret: financeSecret,
    userId: v.id('users'),
    itemId: v.string(),
    accounts: v.array(syncedAccount),
    syncedAt: v.number(),
  },
  handler: async (ctx, { secret, userId, itemId, accounts, syncedAt }) => {
    assertFinanceSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    const date = new Date(syncedAt).toISOString().slice(0, 10);

    const existing = await ctx.db
      .query('financeAccounts')
      .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
      .collect();
    const existingById = new Map(existing.map((a) => [a.accountId, a]));
    const seen = new Set<string>();

    for (const account of accounts) {
      seen.add(account.accountId);
      const previous = existingById.get(account.accountId);
      if (previous) {
        await ctx.db.patch('financeAccounts', previous._id, {
          ...account,
          syncedAt,
        });
      } else {
        await ctx.db.insert('financeAccounts', {
          ...account,
          userId,
          itemId,
          syncedAt,
        });
      }

      const {
        current,
        available,
        limit,
        isoCurrencyCode,
        unofficialCurrencyCode,
      } = account;
      const balances = {
        current,
        available,
        limit,
        isoCurrencyCode,
        unofficialCurrencyCode,
        recordedAt: syncedAt,
      };
      const snapshot = await ctx.db
        .query('financeBalanceSnapshots')
        .withIndex('by_accountId_date', (q) =>
          q.eq('accountId', account.accountId).eq('date', date),
        )
        .unique();
      if (snapshot) {
        await ctx.db.patch('financeBalanceSnapshots', snapshot._id, balances);
      } else {
        await ctx.db.insert('financeBalanceSnapshots', {
          ...balances,
          userId,
          itemId,
          accountId: account.accountId,
          date,
        });
      }
    }

    for (const account of existing) {
      if (!seen.has(account.accountId)) {
        await ctx.db.delete('financeAccounts', account._id);
      }
    }

    await ctx.db.patch('financeItems', item._id, {
      lastSyncedAt: syncedAt,
      status: 'ok',
      errorCode: undefined,
    });
  },
});

/** Marks an item broken after a sync fails at Plaid. The next good sync clears it. */
export const recordSyncError = mutation({
  args: {
    secret: financeSecret,
    userId: v.id('users'),
    itemId: v.string(),
    status: v.union(v.literal('login_required'), v.literal('error')),
    errorCode: v.string(),
  },
  handler: async (ctx, { secret, userId, itemId, status, errorCode }) => {
    assertFinanceSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    await ctx.db.patch('financeItems', item._id, { status, errorCode });
  },
});

// MARK: helpers

async function getOwnedItem(
  ctx: MutationCtx,
  userId: Id<'users'>,
  itemId: string,
): Promise<Doc<'financeItems'>> {
  const item = await ctx.db
    .query('financeItems')
    .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
    .unique();
  if (!item || item.userId !== userId) {
    throw new ConvexError({ code: 'ITEM_NOT_FOUND' });
  }
  return item;
}
