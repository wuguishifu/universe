import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Game night score tracking (janktm-web). There is no auth: a party's code is the only thing
 * standing between a guest and its data, so treat everything here as public.
 */
export const gameTables = {
  gameParties: defineTable({
    name: v.string(),
    /** Short, human-typable join code. Unique across all parties. */
    code: v.string(),
  }).index('by_code', ['code']),

  gameEvents: defineTable({
    partyId: v.id('gameParties'),
    name: v.string(),
    /** Display order within the party. */
    order: v.number(),
    /** `placePoints[0]` is what 1st place earns, `placePoints[1]` 2nd, and so on. */
    placePoints: v.array(v.number()),
    /** What any place past the end of `placePoints` earns. */
    minimumPoints: v.number(),
    /**
     * One entry per round: that round's points are the scoring above times its multiplier.
     * Missing on events from before rounds existed, which means a single 1x round.
     */
    roundMultipliers: v.optional(v.array(v.number())),
  }).index('by_party_order', ['partyId', 'order']),

  gamePlayers: defineTable({
    partyId: v.id('gameParties'),
    /** As the player typed it, for display. */
    name: v.string(),
    /** Lowercased and trimmed: the identity of a player within a party. */
    normalizedName: v.string(),
  }).index('by_party_name', ['partyId', 'normalizedName']),

  /** One row per player per event round they've reported a placement for. */
  gameResults: defineTable({
    partyId: v.id('gameParties'),
    eventId: v.id('gameEvents'),
    playerId: v.id('gamePlayers'),
    /** 1-based. Several players can share a place. */
    place: v.number(),
    /** 0-based index into the event's rounds. Missing means round 0. */
    round: v.optional(v.number()),
  })
    .index('by_party', ['partyId'])
    .index('by_event_player', ['eventId', 'playerId']),
} as const;
