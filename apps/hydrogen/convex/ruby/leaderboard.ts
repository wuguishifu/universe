import { ConvexError, v } from 'convex/values';
import {
  RUBY_LEADERBOARD_SIZE,
  verifyLeaderboardGrant,
} from '@universe/contracts-ruby';
import { query } from '../_generated/server';
import { MAX_PHRASES_PER_GUILD } from './phrases';

/**
 * Every tracked phrase in a server with its top speakers, for sapphire's leaderboard page.
 * Unlike the rest of ruby's functions this is called from browsers, so instead of the secret it
 * takes a grant ruby signed after checking the viewer's server memberships.
 */
export const forViewer = query({
  args: {
    grant: v.string(),
    guildId: v.string(),
  },
  handler: async (ctx, { grant, guildId }) => {
    const secret = process.env.RUBY_CONVEX_SECRET;
    if (!secret) {
      throw new ConvexError('RUBY_CONVEX_SECRET is not set on this deployment');
    }
    // Expiry is only checked when the query (re)runs; sapphire swaps in a fresh grant well
    // before it expires anyway.
    const payload = await verifyLeaderboardGrant(grant, secret);
    if (!payload?.guildIds.includes(guildId)) {
      throw new ConvexError('Unauthorized');
    }

    const phrases = await ctx.db
      .query('trackedPhrases')
      .withIndex('by_guild_normalized', (q) => q.eq('guildId', guildId))
      .take(MAX_PHRASES_PER_GUILD);

    return Promise.all(
      phrases.map(async ({ phrase, normalized }) => {
        const rows = await ctx.db
          .query('phraseCounts')
          .withIndex('by_guild_phrase_count', (q) =>
            q.eq('guildId', guildId).eq('normalized', normalized),
          )
          .order('desc')
          .take(RUBY_LEADERBOARD_SIZE);

        const entries = await Promise.all(
          rows.map(async ({ userId, count }) => {
            const speaker = await ctx.db
              .query('speakers')
              .withIndex('by_guild_user', (q) =>
                q.eq('guildId', guildId).eq('userId', userId),
              )
              .unique();
            return {
              userId,
              count,
              displayName: speaker?.displayName ?? null,
              avatarUrl: speaker?.avatarUrl ?? null,
            };
          }),
        );
        return { phrase, entries };
      }),
    );
  },
});
