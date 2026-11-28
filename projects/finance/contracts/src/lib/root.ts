import { z } from 'zod';

import { c } from './contract';
import {
  errorBodySchema,
  itemSyncResultSchema,
  linkedItemSchema,
  linkKindSchema,
} from './items';

/**
 * Every route needs `Authorization: Bearer <convex auth JWT>`; the user is whoever the token is for,
 * and gets a 403 without a `finance` grant. Through the Cloudflare tunnel, requests also need the
 * Access service token headers.
 */
const errorResponses = {
  400: errorBodySchema,
  401: errorBodySchema,
  403: errorBodySchema,
  404: errorBodySchema,
  409: errorBodySchema,
  502: errorBodySchema,
} as const;

export const financeRootRouter = c.router(
  {
    createLinkToken: {
      method: 'POST',
      path: '/link-token',
      description: 'A Plaid Link token for linking a new institution.',
      body: z.object({ kind: linkKindSchema }),
      responses: {
        200: z.object({
          linkToken: z.string(),
          /** ISO timestamp; a link token lasts 4 hours. */
          expiration: z.string(),
        }),
        ...errorResponses,
      },
    },
    exchangePublicToken: {
      method: 'POST',
      path: '/items',
      description:
        "Exchanges Link's public token for an access token and saves the item, encrypted, to convex.",
      body: z.object({ publicToken: z.string().min(1), kind: linkKindSchema }),
      responses: {
        201: linkedItemSchema,
        ...errorResponses,
      },
    },
    removeItem: {
      method: 'DELETE',
      path: '/items/:itemId',
      description:
        'Removes the item at Plaid (which stops billing for it) and deletes it from convex.',
      pathParams: z.object({ itemId: z.string().min(1) }),
      body: c.noBody(),
      responses: {
        200: z.object({ itemId: z.string() }),
        ...errorResponses,
      },
    },
    syncItems: {
      method: 'POST',
      path: '/sync',
      description:
        "Refreshes the user's accounts and balances from Plaid (accounts.get, which is free) into convex.",
      body: c.noBody(),
      responses: {
        200: z.object({ items: itemSyncResultSchema.array() }),
        ...errorResponses,
      },
    },
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
