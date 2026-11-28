import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { APP_LABELS, type App, APPS, appValidator } from './apps';
import { appMutation, appQuery } from './functions';
import { findGrant, normalizeEmail } from './helpers';

/** admin-web's functions. Everything here needs a grant for `admin`. */
const adminQuery = appQuery('admin');
const adminMutation = appMutation('admin');

/** Every app with its grants, oldest first, and whether each email has an account yet. */
export const apps = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await usersByEmail(ctx);
    return await Promise.all(
      APPS.map(async (app) => {
        const grants = await ctx.db
          .query('accessGrants')
          .withIndex('by_app', (q) => q.eq('app', app))
          .collect();
        return {
          app,
          label: APP_LABELS[app],
          grants: grants
            .sort((a, b) => a.grantedAt - b.grantedAt)
            .map((grant) => ({
              grantId: grant._id,
              email: grant.email,
              grantedAt: grant.grantedAt,
              account: accountState(users.get(grant.email)),
              isYou: grant.email === ctx.viewer.email,
            })),
        };
      }),
    );
  },
});

/** Every account, newest first, with the apps its email has grants for. */
export const users = adminQuery({
  args: {},
  handler: async (ctx) => {
    const [users, grants] = await Promise.all([
      ctx.db.query('users').order('desc').collect(),
      ctx.db.query('accessGrants').collect(),
    ]);
    const appsByEmail = new Map<string, App[]>();
    for (const grant of grants) {
      appsByEmail.set(grant.email, [
        ...(appsByEmail.get(grant.email) ?? []),
        grant.app,
      ]);
    }
    return users.map((user) => ({
      userId: user._id,
      email: user.email ?? null,
      createdAt: user._creationTime,
      verified: user.emailVerificationTime !== undefined,
      apps: (user.email && appsByEmail.get(user.email)) || [],
      isYou: user._id === ctx.viewer.userId,
    }));
  },
});

export const grant = adminMutation({
  args: { email: v.string(), app: appValidator },
  handler: async (ctx, { email: rawEmail, app }) => {
    const email = normalizeEmail(rawEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ code: 'invalid_email' as const });
    }
    const existing = await findGrant(ctx, email, app);
    if (existing) return existing._id;
    return await ctx.db.insert('accessGrants', {
      email,
      app,
      grantedAt: Date.now(),
      grantedBy: ctx.viewer.userId,
    });
  },
});

/**
 * Takes effect immediately: every app checks grants on each request. Someone left with no grants
 * keeps their account, but can't sign in again.
 */
export const revoke = adminMutation({
  args: { grantId: v.id('accessGrants') },
  handler: async (ctx, { grantId }) => {
    const grant = await ctx.db.get('accessGrants', grantId);
    if (!grant) return;
    if (grant.app === 'admin' && grant.email === ctx.viewer.email) {
      throw new ConvexError({ code: 'cannot_revoke_own_admin' as const });
    }
    await ctx.db.delete('accessGrants', grantId);
  },
});

/**
 * Deletes an account and everything Convex Auth keeps for it, signing it out everywhere (an issued
 * JWT still verifies until it expires, but it no longer resolves to a user). Grants are by email
 * and stay, so an invited email can sign up again. App data that references the user (by
 * `userId`) isn't touched: delete that first.
 */
export const deleteUser = adminMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    if (userId === ctx.viewer.userId) {
      throw new ConvexError({ code: 'cannot_delete_self' as const });
    }
    const accounts = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
      .collect();
    for (const account of accounts) {
      await deleteAll(
        ctx,
        'authVerificationCodes',
        await ctx.db
          .query('authVerificationCodes')
          .withIndex('accountId', (q) => q.eq('accountId', account._id))
          .collect(),
      );
      await ctx.db.delete('authAccounts', account._id);
    }
    const sessions = await ctx.db
      .query('authSessions')
      .withIndex('userId', (q) => q.eq('userId', userId))
      .collect();
    for (const session of sessions) {
      await deleteAll(
        ctx,
        'authRefreshTokens',
        await ctx.db
          .query('authRefreshTokens')
          .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
          .collect(),
      );
      await ctx.db.delete('authSessions', session._id);
    }
    if (await ctx.db.get('users', userId)) {
      await ctx.db.delete('users', userId);
    }
  },
});

type AccountState = 'none' | 'unverified' | 'verified';

function accountState(user: Doc<'users'> | undefined): AccountState {
  if (!user) return 'none';
  return user.emailVerificationTime === undefined ? 'unverified' : 'verified';
}

async function usersByEmail(ctx: QueryCtx): Promise<Map<string, Doc<'users'>>> {
  const users = await ctx.db.query('users').collect();
  return new Map(
    users.flatMap((user) => (user.email ? [[user.email, user]] : [])),
  );
}

async function deleteAll<
  Table extends 'authVerificationCodes' | 'authRefreshTokens',
>(ctx: MutationCtx, table: Table, docs: { _id: Id<Table> }[]) {
  for (const doc of docs) {
    await ctx.db.delete(table, doc._id);
  }
}
