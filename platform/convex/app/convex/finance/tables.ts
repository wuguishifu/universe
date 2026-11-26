import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { itemStatus, linkKind } from './validators';

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
} as const;
