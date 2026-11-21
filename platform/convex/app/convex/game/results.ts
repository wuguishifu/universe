import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';

import { MAX_PLACES } from './validators';

/** Records (or with `place: null`, clears) a player's placement in an event. */
export const set = mutation({
  args: {
    playerId: v.id('gamePlayers'),
    eventId: v.id('gameEvents'),
    place: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { playerId, eventId, place }) => {
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

    const existing = await ctx.db
      .query('gameResults')
      .withIndex('by_event_player', (q) =>
        q.eq('eventId', eventId).eq('playerId', playerId),
      )
      .unique();

    if (place === null) {
      if (existing) await ctx.db.delete('gameResults', existing._id);
      return;
    }
    if (existing) {
      await ctx.db.patch('gameResults', existing._id, { place });
    } else {
      await ctx.db.insert('gameResults', {
        partyId: event.partyId,
        eventId,
        playerId,
        place,
      });
    }
  },
});
