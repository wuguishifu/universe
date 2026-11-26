import { ConvexError, v } from 'convex/values';

/**
 * Finance functions that touch access tokens are public (finance-service calls them over HTTP) and a
 * deployment URL isn't a secret, so each one takes this argument, which must match the deployment's
 * FINANCE_CONVEX_SECRET env var. Call assertFinanceSecret first thing in every handler.
 *
 * Functions the web app calls use the signed-in user (getAuthUserId) instead, and never return
 * `encryptedAccessToken`.
 */
export const financeSecret = v.string();

export function assertFinanceSecret(secret: string): void {
  const expected = process.env.FINANCE_CONVEX_SECRET;
  if (!expected) {
    throw new ConvexError(
      'FINANCE_CONVEX_SECRET is not set on this deployment',
    );
  }
  if (secret !== expected) {
    throw new ConvexError('Unauthorized');
  }
}
