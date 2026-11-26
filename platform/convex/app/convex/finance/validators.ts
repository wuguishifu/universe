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
