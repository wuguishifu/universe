import { ConvexError, v } from 'convex/values';

import { appQuery } from '../access/functions';

/**
 * Finance functions that touch access tokens are public (finance-service calls them over HTTP) and a
 * deployment URL isn't a secret, so each one takes this argument, which must match the deployment's
 * FINANCE_CONVEX_SECRET env var. Call assertFinanceSecret first thing in every handler.
 *
 * Functions the web app calls are built with financeQuery instead: they need a signed-in user with
 * a `finance` grant, act as `ctx.viewer`, and never return `encryptedAccessToken`.
 */
export const financeSecret = v.string();

export const financeQuery = appQuery('finance');

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
