import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';

import { resultRound, roundMultipliers } from './scoring';
import { MAX_PLACES } from './validators';

/** Records (or with `place: null`, clears) a player's placement in one round of an event. */
export const set = mutation({
  args: {
    playerId: v.id('gamePlayers'),
    eventId: v.id('gameEvents'),
    place: v.union(v.number(), v.null()),
    /** 0-based. Defaults to the first round. */
    round: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, eventId, place, round = 0 }) => {
    const [player, event] = await Promise.all([
      ctx.db.get('gamePlayers', playerId),
      ctx.db.get('gameEvents', eventId),
    ]);
    if (!player || !event || player.partyId !== event.partyId) {
      throw new ConvexError('That player or event no longer exists.');
    }
    if (
      place !== null &&
      (!Number.isInteger(place) || place < 1 || place > MAX_PLACES + 1)
    ) {
      throw new ConvexError('Invalid place.');
    }
    if (
      !Number.isInteger(round) ||
      round < 0 ||
      round >= roundMultipliers(event).length
    ) {
      throw new ConvexError('That round no longer exists.');
    }

    // At most one row per round, and an event has few rounds, so filtering in memory is fine.
    const existing = (
      await ctx.db
        .query('gameResults')
        .withIndex('by_event_player', (q) =>
          q.eq('eventId', eventId).eq('playerId', playerId),
        )
        .collect()
    ).find((result) => resultRound(result) === round);

    if (place === null) {
      if (existing) await ctx.db.delete('gameResults', existing._id);
      return;
    }
    if (existing) {
      await ctx.db.patch('gameResults', existing._id, { place, round });
    } else {
      await ctx.db.insert('gameResults', {
        partyId: event.partyId,
        eventId,
        playerId,
        place,
        round,
      });
    }
  },
});
