import 'server-only';

import { initClient } from '@ts-rest/core';

import { financeRootRouter } from '@projects/finance-contracts';

import { requireEnv } from '../server-env';

/**
 * A client for finance-service that acts as the user `convexToken` belongs to: the service checks
 * the token itself, so Vercel can't act as anyone it doesn't have a session for.
 */
export function financeServiceClient(convexToken: string) {
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  return initClient(financeRootRouter, {
    baseUrl: requireEnv('FINANCE_SERVICE_URL').replace(/\/+$/, ''),
    baseHeaders: {
      authorization: `Bearer ${convexToken}`,
      // Vercel reaches the tailnet through a Cloudflare tunnel behind Access.
      ...(cfClientId && cfClientSecret
        ? {
            'CF-Access-Client-Id': cfClientId,
            'CF-Access-Client-Secret': cfClientSecret,
          }
        : {}),
    },
  });
}

export type FinanceServiceClient = ReturnType<typeof financeServiceClient>;
