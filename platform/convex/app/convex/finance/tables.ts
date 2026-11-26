import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { accountBalances, itemStatus, linkKind } from './validators';

export const financeTables = {
  /**
   * A Plaid item: one login at one institution, which can hold several accounts. See
   * projects/finance/LINK.md.
   */
  financeItems: defineTable({
    userId: v.id('users'),
    /** Plaid's item_id. Unique across users. */
    itemId: v.string(),
    kind: linkKind,
    institutionId: v.union(v.string(), v.null()),
    institutionName: v.union(v.string(), v.null()),
    /** The products Plaid enabled on the item, which are the ones we can call. */
    products: v.array(v.string()),
    /**
     * AES-256-GCM, bound to userId and itemId. Only finance-service has the key. Never returned from
     * a function the web app can call.
     */
    encryptedAccessToken: v.string(),
    status: itemStatus,
    /** Plaid's error_code when status is `error`. */
    errorCode: v.optional(v.string()),
    /** When OAuth consent runs out (ms since epoch), for institutions that have one. */
    consentExpirationTime: v.optional(v.number()),
    /** From transactions.sync, once syncing exists. */
    transactionsCursor: v.optional(v.string()),
    linkedAt: v.number(),
    lastSyncedAt: v.optional(v.number()),
  })
    .index('by_itemId', ['itemId'])
    .index('by_userId', ['userId']),

  /** An account in an item, as of the item's last sync (Plaid's accounts.get). */
  financeAccounts: defineTable({
    userId: v.id('users'),
    itemId: v.string(),
    /** Plaid's account_id. Unique, but a new one if the item is linked again. */
    accountId: v.string(),
    name: v.string(),
    officialName: v.union(v.string(), v.null()),
    /** The last 2-4 digits of the account number. */
    mask: v.union(v.string(), v.null()),
    /** Plaid's type: depository, credit, loan, investment, brokerage or other. */
    type: v.string(),
    /** e.g. checking, credit card, 401k, mortgage. */
    subtype: v.union(v.string(), v.null()),
    ...accountBalances,
    syncedAt: v.number(),
  })
    .index('by_accountId', ['accountId'])
    .index('by_itemId', ['itemId'])
    .index('by_userId', ['userId']),

  /**
   * Each account's balance once per day (UTC), overwritten by later syncs that day. Plaid only
   * gives current balances, so this is the only history there will be.
   */
  financeBalanceSnapshots: defineTable({
    userId: v.id('users'),
    itemId: v.string(),
    accountId: v.string(),
    /** YYYY-MM-DD, UTC. */
    date: v.string(),
    ...accountBalances,
    recordedAt: v.number(),
  })
    .index('by_accountId_date', ['accountId', 'date'])
    .index('by_itemId', ['itemId'])
    .index('by_userId_date', ['userId', 'date']),
} as const;
