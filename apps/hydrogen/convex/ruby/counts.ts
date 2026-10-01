import { v } from 'convex/values';
import { normalizeText } from '@universe/phrase-matching';
import { mutation, query } from '../_generated/server';
import { assertRubySecret, rubySecret } from './auth';

/** Adds one utterance's matches to the speaker's running totals. */
export const record = mutation({
  args: {
    secret: rubySecret,
    guildId: v.string(),
    userId: v.string(),
    matches: v.array(v.object({ phrase: v.string(), count: v.number() })),
    /** Their current server profile, if ruby could fetch it. */
    speaker: v.optional(
      v.object({ displayName: v.string(), avatarUrl: v.string() }),
    ),
  },
  handler: async (ctx, { secret, guildId, userId, matches, speaker }) => {
    assertRubySecret(secret);
    if (speaker) {
      const existing = await ctx.db
        .query('speakers')
        .withIndex('by_guild_user', (q) =>
          q.eq('guildId', guildId).eq('userId', userId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert('speakers', { guildId, userId, ...speaker });
      } else if (
        existing.displayName !== speaker.displayName ||
        existing.avatarUrl !== speaker.avatarUrl
      ) {
        // Only patch on change, so leaderboard subscribers aren't woken for nothing.
        await ctx.db.patch('speakers', existing._id, speaker);
      }
    }

    for (const match of matches) {
      if (!Number.isInteger(match.count) || match.count <= 0) continue;
      const normalized = normalizeText(match.phrase);
      if (!normalized) continue;

      const existing = await ctx.db
        .query('phraseCounts')
        .withIndex('by_guild_phrase_user', (q) =>
          q
            .eq('guildId', guildId)
            .eq('normalized', normalized)
            .eq('userId', userId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch('phraseCounts', existing._id, {
          count: existing.count + match.count,
        });
      } else {
        await ctx.db.insert('phraseCounts', {
          guildId,
          normalized,
          userId,
          count: match.count,
        });
      }
    }
  },
});

export const leaderboard = query({
  args: {
    secret: rubySecret,
    guildId: v.string(),
    phrase: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { secret, guildId, phrase, limit }) => {
    assertRubySecret(secret);
    const rows = await ctx.db
      .query('phraseCounts')
      .withIndex('by_guild_phrase_count', (q) =>
        q.eq('guildId', guildId).eq('normalized', normalizeText(phrase)),
      )
      .order('desc')
      .take(Math.min(Math.max(limit ?? 10, 1), 25));
    return rows.map((row) => ({ userId: row.userId, count: row.count }));
  },
});
