import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';

import { generateUniqueCode, normalizeCode } from './codes';
import { pointsForPlace, withRanks } from './scoring';
import {
  assertPoints,
  cleanName,
  eventConfig,
  MAX_EVENTS,
  MAX_PLACES,
} from './validators';

type EventResult = {
  playerId: Id<'gamePlayers'>;
  place: number;
  points: number;
};

export const create = mutation({
  args: {
    name: v.string(),
    events: v.array(eventConfig),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 'Party name');
    if (args.events.length === 0) {
      throw new ConvexError('Add at least one event.');
    }
    if (args.events.length > MAX_EVENTS) {
      throw new ConvexError(`A party can have at most ${MAX_EVENTS} events.`);
    }

    const events = args.events.map((event) => {
      const eventName = cleanName(event.name, 'Event name');
      if (event.placePoints.length > MAX_PLACES) {
        throw new ConvexError(
          `"${eventName}" can score at most ${MAX_PLACES} places.`,
        );
      }
      event.placePoints.forEach((points) => assertPoints(points, eventName));
      assertPoints(event.minimumPoints, eventName);
      return { ...event, name: eventName };
    });

    const code = await generateUniqueCode(ctx);
    const partyId = await ctx.db.insert('gameParties', { name, code });
    for (const [order, event] of events.entries()) {
      await ctx.db.insert('gameEvents', { partyId, order, ...event });
    }
    return { code };
  },
});

/**
 * Everything the party page needs in one reactive query: events with their results, players,
 * and the overall standings. Returns null for an unknown code.
 */
export const get = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    if (!code) return null;

    const party = await ctx.db
      .query('gameParties')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique();
    if (!party) return null;

    const [events, players, results] = await Promise.all([
      ctx.db
        .query('gameEvents')
        .withIndex('by_party_order', (q) => q.eq('partyId', party._id))
        .collect(),
      ctx.db
        .query('gamePlayers')
        .withIndex('by_party_name', (q) => q.eq('partyId', party._id))
        .collect(),
      ctx.db
        .query('gameResults')
        .withIndex('by_party', (q) => q.eq('partyId', party._id))
        .collect(),
    ]);

    const totals = new Map(
      players.map((player) => [player._id, { total: 0, eventsPlayed: 0 }]),
    );
    const eventsById = new Map(events.map((event) => [event._id, event]));
    const resultsByEvent = new Map<Id<'gameEvents'>, EventResult[]>(
      events.map((event) => [event._id, []]),
    );

    for (const result of results) {
      const event = eventsById.get(result.eventId);
      const playerTotal = totals.get(result.playerId);
      if (!event || !playerTotal) continue;
      const points = pointsForPlace(event, result.place);
      playerTotal.total += points;
      playerTotal.eventsPlayed += 1;
      resultsByEvent.get(event._id)?.push({
        playerId: result.playerId,
        place: result.place,
        points,
      });
    }

    const sortedPlayers = players
      .map((player) => ({
        playerId: player._id,
        name: player.name,
        ...(totals.get(player._id) ?? { total: 0, eventsPlayed: 0 }),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const standings = withRanks(sortedPlayers);

    return {
      party: { _id: party._id, name: party.name, code: party.code },
      players: players
        .map((player) => ({ _id: player._id, name: player.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      events: events.map((event) => ({
        _id: event._id,
        name: event.name,
        placePoints: event.placePoints,
        minimumPoints: event.minimumPoints,
        results: (resultsByEvent.get(event._id) ?? []).sort(
          (a, b) => a.place - b.place,
        ),
      })),
      standings,
    };
  },
});
