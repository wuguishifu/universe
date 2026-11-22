import { ConvexError, type Infer, v } from 'convex/values';

export const MAX_EVENTS = 30;
export const MAX_PLACES = 20;
export const MAX_PLAYERS = 100;
export const MAX_ROUNDS = 20;
export const MAX_MULTIPLIER = 100;
export const MAX_NAME_LENGTH = 60;

export const eventConfig = v.object({
  /** Set when editing an existing event; omitted for a new one. */
  _id: v.optional(v.id('gameEvents')),
  name: v.string(),
  placePoints: v.array(v.number()),
  minimumPoints: v.number(),
  /** One multiplier per round. Omitted means a single 1x round. */
  roundMultipliers: v.optional(v.array(v.number())),
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

export function assertPoints(points: number, eventName: string): void {
  if (!Number.isFinite(points) || points < 0 || points > 1_000_000) {
    throw new ConvexError(`"${eventName}" has an invalid point value.`);
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
    if (event.placePoints.length > MAX_PLACES) {
      throw new ConvexError(
        `"${name}" can score at most ${MAX_PLACES} places.`,
      );
    }
    event.placePoints.forEach((points) => assertPoints(points, name));
    assertPoints(event.minimumPoints, name);

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
    return { ...event, name, roundMultipliers };
  });
}
