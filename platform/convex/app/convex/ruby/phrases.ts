import { ConvexError, v } from 'convex/values';
import { MAX_PHRASE_LENGTH, normalizeText } from '@libs/phrase-matching';
import { mutation, query } from '../_generated/server';
import { assertRubySecret, rubySecret } from './auth';

/** Keeps per-utterance matching (and the /words list reply) small. */
const MAX_PHRASES_PER_GUILD = 50;

export const list = query({
  args: {
    secret: rubySecret,
    guildId: v.string(),
  },
  handler: async (ctx, { secret, guildId }) => {
    assertRubySecret(secret);
    const rows = await ctx.db
      .query('trackedPhrases')
      .withIndex('by_guild_normalized', (q) => q.eq('guildId', guildId))
      .take(MAX_PHRASES_PER_GUILD);
    return rows.map((row) => row.phrase);
  },
});

/** Throws a ConvexError with a user-facing message if the phrase is invalid or the guild is full. */
export const add = mutation({
  args: {
    secret: rubySecret,
    guildId: v.string(),
    phrase: v.string(),
  },
  handler: async (ctx, { secret, guildId, phrase }) => {
    assertRubySecret(secret);
    const trimmed = phrase.trim();
    const normalized = normalizeText(trimmed);
    if (!normalized) {
      throw new ConvexError('That phrase has no letters or numbers in it.');
    }
    if (trimmed.length > MAX_PHRASE_LENGTH) {
      throw new ConvexError(
        `Phrases can be at most ${MAX_PHRASE_LENGTH} characters.`,
      );
    }

    const existing = await ctx.db
      .query('trackedPhrases')
      .withIndex('by_guild_normalized', (q) =>
        q.eq('guildId', guildId).eq('normalized', normalized),
      )
      .unique();
    if (existing) return { added: false };

    const tracked = await ctx.db
      .query('trackedPhrases')
      .withIndex('by_guild_normalized', (q) => q.eq('guildId', guildId))
      .take(MAX_PHRASES_PER_GUILD);
    if (tracked.length >= MAX_PHRASES_PER_GUILD) {
      throw new ConvexError(
        `A server can track at most ${MAX_PHRASES_PER_GUILD} phrases.`,
      );
    }

    await ctx.db.insert('trackedPhrases', {
      guildId,
      phrase: trimmed,
      normalized,
    });
    return { added: true };
  },
});

export const remove = mutation({
  args: {
    secret: rubySecret,
    guildId: v.string(),
    phrase: v.string(),
  },
  handler: async (ctx, { secret, guildId, phrase }) => {
    assertRubySecret(secret);
    const existing = await ctx.db
      .query('trackedPhrases')
      .withIndex('by_guild_normalized', (q) =>
        q.eq('guildId', guildId).eq('normalized', normalizeText(phrase)),
      )
      .unique();
    if (!existing) return { removed: false };

    // Counts are intentionally kept so re-tracking the phrase restores its leaderboard.
    await ctx.db.delete('trackedPhrases', existing._id);
    return { removed: true };
  },
});
