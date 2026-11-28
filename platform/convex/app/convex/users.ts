import { getAuthUserId } from '@convex-dev/auth/server';

import { query } from './_generated/server';

/** The signed-in user, or null when signed out. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get('users', userId);
    return user ? { userId, email: user.email ?? null } : null;
  },
});
