import { ConvexError, v } from 'convex/values';

export const MAX_EVENTS = 30;
export const MAX_PLACES = 20;
export const MAX_PLAYERS = 100;
export const MAX_NAME_LENGTH = 60;

export const eventConfig = v.object({
  name: v.string(),
  placePoints: v.array(v.number()),
  minimumPoints: v.number(),
});

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
