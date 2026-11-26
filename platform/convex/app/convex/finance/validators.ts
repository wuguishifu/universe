import { v } from 'convex/values';

/** Which Plaid products an item was linked with (see finance-service's link-products.ts). */
export const linkKind = v.union(v.literal('bank'), v.literal('investments'));

/**
 * - `ok`: working.
 * - `login_required`: the login broke (password change, MFA, revoked consent); needs a reconnect.
 * - `pending_expiration`: OAuth consent expires soon; reconnect before consentExpirationTime.
 * - `error`: any other Plaid item error, in `errorCode`.
 */
export const itemStatus = v.union(
  v.literal('ok'),
  v.literal('login_required'),
  v.literal('pending_expiration'),
  v.literal('error'),
);

/**
 * Plaid's balances. For depository and investment accounts `current` is what's in them; for credit
 * and loan accounts it's what's owed (positive). Any of them can be missing.
 */
export const accountBalances = {
  current: v.union(v.number(), v.null()),
  available: v.union(v.number(), v.null()),
  /** Credit limit, for credit accounts and lines of credit. */
  limit: v.union(v.number(), v.null()),
  isoCurrencyCode: v.union(v.string(), v.null()),
  /** For currencies ISO doesn't cover (e.g. crypto); isoCurrencyCode is null then. */
  unofficialCurrencyCode: v.union(v.string(), v.null()),
};

/** An account from Plaid's accounts.get, as finance-service sends it. */
export const syncedAccount = v.object({
  accountId: v.string(),
  name: v.string(),
  officialName: v.union(v.string(), v.null()),
  mask: v.union(v.string(), v.null()),
  type: v.string(),
  subtype: v.union(v.string(), v.null()),
  ...accountBalances,
});
