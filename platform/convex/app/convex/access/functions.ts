import {
  customCtx,
  customMutation,
  customQuery,
} from 'convex-helpers/server/customFunctions';

import { mutation, query } from '../_generated/server';

import type { App } from './apps';
import { requireAppAccess } from './helpers';

/**
 * Public functions that only people with a grant for `app` can call. Handlers get the caller as
 * `ctx.viewer`; anyone else gets a ConvexError with code `unauthenticated` or `forbidden`.
 *
 *   const albumQuery = appQuery('janktm');
 *   export const list = albumQuery({ args: {}, handler: async (ctx) => { ctx.viewer.email ... } });
 */
export function appQuery(app: App) {
  return customQuery(
    query,
    customCtx(async (ctx) => ({ viewer: await requireAppAccess(ctx, app) })),
  );
}

export function appMutation(app: App) {
  return customMutation(
    mutation,
    customCtx(async (ctx) => ({ viewer: await requireAppAccess(ctx, app) })),
  );
}
