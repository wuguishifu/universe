import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

import { appValidator } from './apps';
import { findGrant, hasAnyGrant, normalizeEmail } from './helpers';

/** Whether `userId` may get a session at all: they need a grant for at least one app (auth.ts). */
export const canSignIn = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get('users', userId);
    return user?.email ? await hasAnyGrant(ctx, user.email) : false;
  },
});

/**
 * Grants from the CLI, for when there's no admin yet to use admin-web:
 *
 *   nx convex convex-app -- run access/internal:grant '{"email": "you@example.com", "app": "admin"}'
 */
export const grant = internalMutation({
  args: { email: v.string(), app: appValidator },
  handler: async (ctx, { email: rawEmail, app }) => {
    const email = normalizeEmail(rawEmail);
    const existing = await findGrant(ctx, email, app);
    if (existing) return existing._id;
    return await ctx.db.insert('accessGrants', {
      email,
      app,
      grantedAt: Date.now(),
    });
  },
});
