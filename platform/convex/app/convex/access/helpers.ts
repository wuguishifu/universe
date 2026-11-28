import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import type { App } from './apps';

type ReadCtx = Pick<QueryCtx, 'auth' | 'db'>;

export type Viewer = { userId: Id<'users'>; email: string };

/** Trimmed and lowercased, so `Bo@x.com` and `bo@x.com ` are one account and one invite. */
export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) {
    throw new ConvexError({ code: 'email_required' as const });
  }
  return email;
}

/** The signed-in user, or null when signed out (or their account was deleted). */
export async function getViewer(ctx: ReadCtx): Promise<Viewer | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get('users', userId);
  return user?.email ? { userId, email: user.email } : null;
}

export async function findGrant(
  ctx: ReadCtx,
  email: string,
  app: App,
): Promise<Doc<'accessGrants'> | null> {
  return await ctx.db
    .query('accessGrants')
    .withIndex('by_email_app', (q) => q.eq('email', email).eq('app', app))
    .unique();
}

export async function hasAnyGrant(
  ctx: ReadCtx,
  email: string,
): Promise<boolean> {
  const grant = await ctx.db
    .query('accessGrants')
    .withIndex('by_email_app', (q) => q.eq('email', email))
    .first();
  return grant !== null;
}

/**
 * The signed-in user, if they have a grant for `app`. Call it first thing in every function that
 * belongs to an app, or build the function with appQuery/appMutation (./functions.ts).
 */
export async function requireAppAccess(
  ctx: ReadCtx,
  app: App,
): Promise<Viewer> {
  const viewer = await getViewer(ctx);
  if (!viewer) {
    throw new ConvexError({ code: 'unauthenticated' as const });
  }
  if (!(await findGrant(ctx, viewer.email, app))) {
    throw new ConvexError({ code: 'forbidden' as const, app });
  }
  return viewer;
}
