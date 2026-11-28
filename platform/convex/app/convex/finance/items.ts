import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { mutation, query, type QueryCtx } from '../_generated/server';

import { assertFinanceSecret, financeQuery, financeSecret } from './auth';
import { linkKind } from './validators';

// MARK: web app (signed-in user)

/** The signed-in user's items, oldest first. Never includes the access token. */
export const list = financeQuery({
  args: {},
  handler: async (ctx) => {
    const { userId } = ctx.viewer;
    const items = await ctx.db
      .query('financeItems')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect();
    return items
      .sort((a, b) => a.linkedAt - b.linkedAt)
      .map((item) => toSummary(item));
  },
});

// MARK: finance-service

/**
 * Saves an item after Plaid Link. Linking the same item again (update mode) replaces its token and
 * resets its status, keeping linkedAt.
 */
export const upsertLinked = mutation({
  args: {
    secret: financeSecret,
    userId: v.id('users'),
    itemId: v.string(),
    kind: linkKind,
    institutionId: v.union(v.string(), v.null()),
    institutionName: v.union(v.string(), v.null()),
    products: v.array(v.string()),
    encryptedAccessToken: v.string(),
    consentExpirationTime: v.optional(v.number()),
  },
  handler: async (ctx, { secret, userId, ...item }) => {
    assertFinanceSecret(secret);
    if (!(await ctx.db.get('users', userId))) {
      throw new ConvexError({ code: 'USER_NOT_FOUND' });
    }

    const existing = await getByItemId(ctx, item.itemId);
    if (existing && existing.userId !== userId) {
      throw new ConvexError({ code: 'ITEM_BELONGS_TO_ANOTHER_USER' });
    }
    if (existing) {
      await ctx.db.patch('financeItems', existing._id, {
        ...item,
        status: 'ok',
        errorCode: undefined,
      });
      const updated = await ctx.db.get('financeItems', existing._id);
      // Just patched, so it's there.
      return toSummary(updated ?? existing);
    }

    const id = await ctx.db.insert('financeItems', {
      ...item,
      userId,
      status: 'ok',
      linkedAt: Date.now(),
    });
    const inserted = await ctx.db.get('financeItems', id);
    if (!inserted) throw new ConvexError({ code: 'ITEM_NOT_FOUND' });
    return toSummary(inserted);
  },
});

/** The encrypted access token for one of `userId`'s items, for finance-service to decrypt. */
export const getEncryptedAccessToken = query({
  args: { secret: financeSecret, userId: v.id('users'), itemId: v.string() },
  handler: async (ctx, { secret, userId, itemId }) => {
    assertFinanceSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    return { encryptedAccessToken: item.encryptedAccessToken };
  },
});

/**
 * Deletes one of `userId`'s items with its accounts and balance history. finance-service calls
 * Plaid's item.remove first.
 */
export const remove = mutation({
  args: { secret: financeSecret, userId: v.id('users'), itemId: v.string() },
  handler: async (ctx, { secret, userId, itemId }) => {
    assertFinanceSecret(secret);
    const item = await getOwnedItem(ctx, userId, itemId);
    const [accounts, snapshots] = await Promise.all([
      ctx.db
        .query('financeAccounts')
        .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
        .collect(),
      ctx.db
        .query('financeBalanceSnapshots')
        .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
        .collect(),
    ]);
    for (const account of accounts) {
      await ctx.db.delete('financeAccounts', account._id);
    }
    // One per account per day, so this is fine for years; past that it would need batching.
    for (const snapshot of snapshots) {
      await ctx.db.delete('financeBalanceSnapshots', snapshot._id);
    }
    await ctx.db.delete('financeItems', item._id);
  },
});

// MARK: helpers

function getByItemId(ctx: QueryCtx, itemId: string) {
  return ctx.db
    .query('financeItems')
    .withIndex('by_itemId', (q) => q.eq('itemId', itemId))
    .unique();
}

/** Throws ITEM_NOT_FOUND for another user's item too, so item IDs can't be probed. */
async function getOwnedItem(
  ctx: QueryCtx,
  userId: Doc<'users'>['_id'],
  itemId: string,
): Promise<Doc<'financeItems'>> {
  const item = await getByItemId(ctx, itemId);
  if (!item || item.userId !== userId) {
    throw new ConvexError({ code: 'ITEM_NOT_FOUND' });
  }
  return item;
}

/** Everything but the token and the sync cursor. */
function toSummary({
  encryptedAccessToken: _token,
  transactionsCursor: _cursor,
  userId: _userId,
  ...item
}: Doc<'financeItems'>) {
  return item;
}
