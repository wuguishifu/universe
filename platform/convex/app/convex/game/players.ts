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

/** Renames a player. Fails if someone else in the party already has that name. */
export const rename = mutation({
  args: { playerId: v.id('gamePlayers'), name: v.string() },
  handler: async (ctx, args) => {
    const player = await ctx.db.get('gamePlayers', args.playerId);
    if (!player) throw new ConvexError('That player no longer exists.');
    const name = cleanName(args.name, 'Name');
    const normalizedName = name.toLowerCase();

    const clash = await ctx.db
      .query('gamePlayers')
      .withIndex('by_party_name', (q) =>
        q.eq('partyId', player.partyId).eq('normalizedName', normalizedName),
      )
      .unique();
    if (clash && clash._id !== player._id) {
      throw new ConvexError(`Someone is already called ${clash.name}.`);
    }
    await ctx.db.patch('gamePlayers', player._id, { name, normalizedName });
  },
});

/** Removes a player and all of their results. */
export const remove = mutation({
  args: { playerId: v.id('gamePlayers') },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get('gamePlayers', playerId);
    if (!player) return;
    const results = await ctx.db
      .query('gameResults')
      .withIndex('by_party', (q) => q.eq('partyId', player.partyId))
      .collect();
    for (const result of results) {
      if (result.playerId === playerId) {
        await ctx.db.delete('gameResults', result._id);
      }
    }
    await ctx.db.delete('gamePlayers', playerId);
  },
});
