import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import {
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from '../_generated/server';

import { generateUniqueCode, normalizeCode } from './codes';
import {
  resultRound,
  roundMode,
  roundMultipliers,
  roundPlaceScoring,
  roundPoints,
  scoreEvent,
  withRanks,
} from './scoring';
import { cleanEvents, cleanName, eventConfig } from './validators';

export const create = mutation({
  args: {
    name: v.string(),
    events: v.array(eventConfig),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 'Party name');
    const events = cleanEvents(args.events);

    const code = await generateUniqueCode(ctx);
    const partyId = await ctx.db.insert('gameParties', { name, code });
    for (const [order, { _id, ...event }] of events.entries()) {
      await ctx.db.insert('gameEvents', { partyId, order, ...event });
    }
    return { code };
  },
});

/**
 * Replaces a party's name and event list. Events with an `_id` are updated in place (keeping
 * their results), events without one are added, and existing events left out are deleted along
 * with their results. Anyone with the code can do this.
 */
export const update = mutation({
  args: {
    partyId: v.id('gameParties'),
    name: v.string(),
    events: v.array(eventConfig),
  },
  handler: async (ctx, args) => {
    const party = await ctx.db.get('gameParties', args.partyId);
    if (!party) throw new ConvexError('That party no longer exists.');
    const name = cleanName(args.name, 'Party name');
    const events = cleanEvents(args.events);

    const existing = await ctx.db
      .query('gameEvents')
      .withIndex('by_party_order', (q) => q.eq('partyId', party._id))
      .collect();
    const existingById = new Map(existing.map((event) => [event._id, event]));
    const keptIds = new Set<Id<'gameEvents'>>();

    await ctx.db.patch('gameParties', party._id, { name });

    for (const [order, { _id, ...event }] of events.entries()) {
      const previous = _id && existingById.get(_id);
      if (!previous) {
        if (_id) throw new ConvexError('An event you edited was deleted.');
        await ctx.db.insert('gameEvents', {
          partyId: party._id,
          order,
          ...event,
        });
        continue;
      }
      if (keptIds.has(previous._id)) {
        throw new ConvexError(`"${event.name}" is listed twice.`);
      }
      keptIds.add(previous._id);
      await ctx.db.patch('gameEvents', previous._id, { order, ...event });
      await reconcileResults(ctx, previous, {
        scoredPlaces: roundPlaceScoring(event).placePoints.length,
        rounds: roundMultipliers(event).length,
      });
    }

    for (const event of existing) {
      if (keptIds.has(event._id)) continue;
      for (const result of await resultsForEvent(ctx, event._id)) {
        await ctx.db.delete('gameResults', result._id);
      }
      await ctx.db.delete('gameEvents', event._id);
    }
  },
});

function resultsForEvent(ctx: QueryCtx, eventId: Id<'gameEvents'>) {
  return ctx.db
    .query('gameResults')
    .withIndex('by_event_player', (q) => q.eq('eventId', eventId))
    .collect();
}

/**
 * Keeps an edited event's results consistent with its new shape:
 * - Results in rounds that no longer exist are deleted.
 * - "Other" is stored as one past the last scored round place (the event's places, or the
 *   round scoring's in 'standings' mode). When that count changes, everyone who was in "Other"
 *   (or whose place no longer exists) moves to the new "Other", so adding a 4th place doesn't
 *   silently promote all the "Other" players to 4th.
 */
async function reconcileResults(
  ctx: MutationCtx,
  previous: Doc<'gameEvents'>,
  { scoredPlaces, rounds }: { scoredPlaces: number; rounds: number },
) {
  const previousPlaces = roundPlaceScoring(previous).placePoints.length;
  const placesChanged = previousPlaces !== scoredPlaces;
  const roundsShrank = roundMultipliers(previous).length > rounds;
  if (!placesChanged && !roundsShrank) return;

  for (const result of await resultsForEvent(ctx, previous._id)) {
    if (resultRound(result) >= rounds) {
      await ctx.db.delete('gameResults', result._id);
      continue;
    }
    const wasOther = result.place > previousPlaces;
    if (placesChanged && (wasOther || result.place > scoredPlaces)) {
      await ctx.db.patch('gameResults', result._id, {
        place: scoredPlaces + 1,
      });
    }
  }
}

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

    const playerIds = new Set(players.map((player) => player._id));
    const resultsByEvent = new Map<Id<'gameEvents'>, Doc<'gameResults'>[]>();
    for (const result of results) {
      if (!playerIds.has(result.playerId)) continue;
      const eventResults = resultsByEvent.get(result.eventId) ?? [];
      eventResults.push(result);
      resultsByEvent.set(result.eventId, eventResults);
    }
    const namesById = new Map(players.map((p) => [p._id, p.name]));
    const byName = (a: Id<'gamePlayers'>, b: Id<'gamePlayers'>) =>
      (namesById.get(a) ?? '').localeCompare(namesById.get(b) ?? '');

    const totals = new Map(
      players.map((player) => [player._id, { total: 0, eventsPlayed: 0 }]),
    );
    const scoredEvents = events.map((event) => {
      const scored = scoreEvent(event, resultsByEvent.get(event._id) ?? []);
      for (const [playerId, points] of scored.partyPoints) {
        const playerTotal = totals.get(playerId);
        if (!playerTotal) continue;
        playerTotal.total += points;
        playerTotal.eventsPlayed += 1;
      }
      return {
        _id: event._id,
        name: event.name,
        placePoints: event.placePoints,
        minimumPoints: event.minimumPoints,
        roundMultipliers: roundMultipliers(event),
        roundMode: roundMode(event),
        /** Set only in 'standings' mode; otherwise rounds use the event's own place points. */
        roundScoring:
          roundMode(event) === 'standings' ? roundPlaceScoring(event) : null,
        results: scored.results.sort(
          (a, b) => a.round - b.round || a.place - b.place,
        ),
        standings:
          scored.standings?.sort(
            (a, b) => a.rank - b.rank || byName(a.playerId, b.playerId),
          ) ?? null,
      };
    });

    const sortedPlayers = players
      .map((player) => {
        const playerTotal = totals.get(player._id);
        return {
          playerId: player._id,
          name: player.name,
          total: roundPoints(playerTotal?.total ?? 0),
          /** Distinct events with at least one result, whatever the round count. */
          eventsPlayed: playerTotal?.eventsPlayed ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const standings = withRanks(sortedPlayers);

    return {
      party: { _id: party._id, name: party.name, code: party.code },
      players: players
        .map((player) => ({ _id: player._id, name: player.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      events: scoredEvents,
      standings,
    };
  },
});
