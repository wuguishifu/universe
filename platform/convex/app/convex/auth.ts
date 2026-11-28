import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';

import { internal } from './_generated/api';
import { ResetPasswordOtp, VerifyEmailOtp } from './access/emails';
import { normalizeEmail } from './access/helpers';

/**
 * Email + password, invite-only. Accounts are deployment-wide, so every app on this deployment that
 * uses Convex Auth shares these users; what each person can use is up to their grants
 * (access/tables.ts), managed in admin-web.
 *
 * - Signing up needs a grant for at least one app, so uninvited emails never get an account (or a
 *   code emailed to them).
 * - An address is verified with an emailed code before its first session, so whoever is invited
 *   has to own the address.
 * - Every new session needs a grant for at least one app. Which app is checked by the app itself:
 *   its proxy (@libs/web-auth) for pages and appQuery/appMutation (access/functions.ts) for data.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => ({ email: normalizeEmail(params.email) }),
      verify: VerifyEmailOtp,
      reset: ResetPasswordOtp,
    }),
  ],
  callbacks: {
    // Runs in the same mutation that creates the user, so throwing here means no account at all.
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId !== null) return;
      if (
        !(await ctx.runQuery(internal.access.internal.canSignIn, { userId }))
      ) {
        throw new ConvexError({ code: 'not_invited' as const });
      }
    },
    async beforeSessionCreation(ctx, { userId }) {
      if (
        !(await ctx.runQuery(internal.access.internal.canSignIn, { userId }))
      ) {
        throw new ConvexError({ code: 'no_access' as const });
      }
    },
  },
});
