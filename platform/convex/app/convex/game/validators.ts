import { ConvexError, type Infer, v } from 'convex/values';

export const MAX_EVENTS = 30;
export const MAX_PLACES = 20;
export const MAX_PLAYERS = 100;
export const MAX_ROUNDS = 20;
export const MAX_MULTIPLIER = 100;
export const MAX_NAME_LENGTH = 60;

/** See `gameEvents.roundMode`. */
export const roundMode = v.union(v.literal('perRound'), v.literal('standings'));

/** Points by place: `placePoints[0]` for 1st, and `minimumPoints` for every place past the end. */
export const placeScoring = v.object({
  placePoints: v.array(v.number()),
  minimumPoints: v.number(),
});

export type PlaceScoring = Infer<typeof placeScoring>;

export const eventConfig = v.object({
  /** Set when editing an existing event; omitted for a new one. */
  _id: v.optional(v.id('gameEvents')),
  name: v.string(),
  placePoints: v.array(v.number()),
  minimumPoints: v.number(),
  /** One multiplier per round. Omitted means a single 1x round. */
  roundMultipliers: v.optional(v.array(v.number())),
  /** Omitted means 'perRound'. */
  roundMode: v.optional(roundMode),
  /** Required in 'standings' mode, ignored otherwise. */
  roundScoring: v.optional(placeScoring),
});

export type EventConfig = Infer<typeof eventConfig>;

/** Trims a user-entered name and throws a user-facing ConvexError if it's empty or too long. */
export function cleanName(name: string, what: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new ConvexError(`${what} can't be empty.`);
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ConvexError(
      `${what} can be at most ${MAX_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/** Points must be 0 to 1,000,000 with at most one decimal place, like 2.5. */
export function assertPoints(points: number, eventName: string): void {
  if (
    !Number.isFinite(points) ||
    points < 0 ||
    points > 1_000_000 ||
    Math.abs(points * 10 - Math.round(points * 10)) > 1e-9
  ) {
    throw new ConvexError(
      `"${eventName}" has an invalid point value. Use a number from 0 up, with at most 1 decimal place.`,
    );
  }
}

/** Validates a party's full event list, throwing a user-facing ConvexError on the first problem. */
export function cleanEvents(events: EventConfig[]): EventConfig[] {
  if (events.length === 0) throw new ConvexError('Add at least one event.');
  if (events.length > MAX_EVENTS) {
    throw new ConvexError(`A party can have at most ${MAX_EVENTS} events.`);
  }
  return events.map((event) => {
    const name = cleanName(event.name, 'Event name');
    assertPlaceScoring(event, name);

    const roundMultipliers = event.roundMultipliers?.length
      ? event.roundMultipliers
      : [1];
    if (roundMultipliers.length > MAX_ROUNDS) {
      throw new ConvexError(`"${name}" can have at most ${MAX_ROUNDS} rounds.`);
    }
    for (const multiplier of roundMultipliers) {
      if (
        !Number.isFinite(multiplier) ||
        multiplier <= 0 ||
        multiplier > MAX_MULTIPLIER
      ) {
        throw new ConvexError(
          `"${name}" has an invalid round multiplier. Use a number above 0, up to ${MAX_MULTIPLIER}.`,
        );
      }
    }

    const roundMode = event.roundMode ?? 'perRound';
    let roundScoring: PlaceScoring | undefined;
    if (roundMode === 'standings') {
      if (!event.roundScoring) {
        throw new ConvexError(`"${name}" needs points for each round.`);
      }
      assertPlaceScoring(event.roundScoring, name);
      roundScoring = event.roundScoring;
    }
    return { ...event, name, roundMultipliers, roundMode, roundScoring };
  });
}

function assertPlaceScoring(scoring: PlaceScoring, eventName: string): void {
  if (scoring.placePoints.length > MAX_PLACES) {
    throw new ConvexError(
      `"${eventName}" can score at most ${MAX_PLACES} places.`,
    );
  }
  scoring.placePoints.forEach((points) => assertPoints(points, eventName));
  assertPoints(scoring.minimumPoints, eventName);
}
