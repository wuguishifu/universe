import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const rubyTables = {
  /** Phrases a Discord guild is tracking. */
  trackedPhrases: defineTable({
    guildId: v.string(),
    /** As the user typed it, for display. */
    phrase: v.string(),
    /** `normalizeText(phrase)`: the identity of a phrase within a guild. */
    normalized: v.string(),
  }).index('by_guild_normalized', ['guildId', 'normalized']),

  /**
   * How many times each user has said each phrase. Keyed by the normalized phrase rather than
   * the trackedPhrases row, so untracking and re-tracking a phrase keeps its history.
   */
  phraseCounts: defineTable({
    guildId: v.string(),
    normalized: v.string(),
    userId: v.string(),
    count: v.number(),
  })
    .index('by_guild_phrase_user', ['guildId', 'normalized', 'userId'])
    .index('by_guild_phrase_count', ['guildId', 'normalized', 'count']),
} as const;
