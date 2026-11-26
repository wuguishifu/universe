'use server';

import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { z } from 'zod';

import {
  type ItemSyncResult,
  linkKindSchema,
} from '@projects/finance-contracts';

import {
  financeServiceClient,
  type FinanceServiceClient,
} from '../finance-service/finance-service-client';

// Server actions that forward to finance-service as the signed-in user. They return errors rather
// than throwing them, because Next hides a thrown error's message in production.

export type ActionResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; message: string };

export async function createLinkToken(
  kind: unknown,
): Promise<ActionResult<{ linkToken: string }>> {
  const parsedKind = linkKindSchema.safeParse(kind);
  if (!parsedKind.success)
    return { ok: false, message: 'Unknown account type' };

  return await withFinanceService(async (client) => {
    const response = await client.createLinkToken({
      body: { kind: parsedKind.data },
    });
    return response.status === 200
      ? { ok: true, linkToken: response.body.linkToken }
      : failure(response);
  });
}

const exchangeSchema = z.object({
  publicToken: z.string().min(1),
  kind: linkKindSchema,
});

export async function exchangePublicToken(
  input: unknown,
): Promise<ActionResult<{ institutionName: string | null }>> {
  const parsed = exchangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Invalid request' };

  return await withFinanceService(async (client) => {
    const response = await client.exchangePublicToken({ body: parsed.data });
    return response.status === 201
      ? { ok: true, institutionName: response.body.institutionName }
      : failure(response);
  });
}

export async function removeItem(itemId: unknown): Promise<ActionResult> {
  const parsed = z.string().min(1).safeParse(itemId);
  if (!parsed.success) return { ok: false, message: 'Invalid item' };

  return await withFinanceService(async (client) => {
    const response = await client.removeItem({
      params: { itemId: parsed.data },
    });
    return response.status === 200 ? { ok: true } : failure(response);
  });
}

/** Refreshes the user's balances from Plaid into convex; the page updates from convex on its own. */
export async function syncAccounts(): Promise<
  ActionResult<{ items: ItemSyncResult[] }>
> {
  return await withFinanceService(async (client) => {
    const response = await client.syncItems();
    return response.status === 200
      ? { ok: true, items: response.body.items }
      : failure(response);
  });
}

async function withFinanceService<T extends object>(
  call: (client: FinanceServiceClient) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const token = await convexAuthNextjsToken();
  if (!token) return { ok: false, message: 'Signed out. Sign in again.' };
  try {
    return await call(financeServiceClient(token));
  } catch (error) {
    // Only the message: the error can carry the request's headers, tokens included.
    // eslint-disable-next-line no-console
    console.error(
      "Couldn't reach finance-service:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, message: "Couldn't reach finance-service" };
  }
}

const errorBodySchema = z.object({ message: z.string() });

function failure(response: { status: number; body: unknown }): {
  ok: false;
  message: string;
} {
  if (response.status === 401) {
    return { ok: false, message: 'Your session expired. Sign in again.' };
  }
  const body = errorBodySchema.safeParse(response.body);
  return {
    ok: false,
    message: body.success
      ? body.data.message
      : `finance-service returned ${response.status}`,
  };
}
