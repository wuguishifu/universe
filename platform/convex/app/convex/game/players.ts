import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';

import { normalizeCode } from './codes';
import { cleanName, MAX_PLAYERS } from './validators';

/**
 * Joins a party by name. Joining with a name that's already taken returns that player, so a
 * guest can pick themselves back up on another device.
 */
export const join = mutation({
  args: { code: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const party = await ctx.db
      .query('gameParties')
      .withIndex('by_code', (q) => q.eq('code', normalizeCode(args.code)))
      .unique();
    if (!party) throw new ConvexError('No party with that code.');

    const name = cleanName(args.name, 'Name');
    const normalizedName = name.toLowerCase();

    const existing = await ctx.db
      .query('gamePlayers')
      .withIndex('by_party_name', (q) =>
        q.eq('partyId', party._id).eq('normalizedName', normalizedName),
      )
      .unique();
    if (existing) return { playerId: existing._id };

    const players = await ctx.db
      .query('gamePlayers')
      .withIndex('by_party_name', (q) => q.eq('partyId', party._id))
      .take(MAX_PLAYERS);
    if (players.length >= MAX_PLAYERS) {
      throw new ConvexError(`A party can have at most ${MAX_PLAYERS} players.`);
    }

    const playerId = await ctx.db.insert('gamePlayers', {
      partyId: party._id,
      name,
      normalizedName,
    });
    return { playerId };
  },
});
