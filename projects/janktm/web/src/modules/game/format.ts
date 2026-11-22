import { ConvexError } from 'convex/values';

export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Places past the scored ones all share the minimum, so they're shown as one "Other" bucket. */
export function placeLabel(place: number, scoredPlaces: number): string {
  return place > scoredPlaces ? 'Other' : ordinal(place);
}

export function pointsLabel(points: number): string {
  return `${points} ${points === 1 ? 'pt' : 'pts'}`;
}

/** e.g. "1st 10 · 2nd 5 · others 1", with every value scaled by `multiplier`. */
export function describeScoring(
  event: { placePoints: number[]; minimumPoints: number },
  multiplier = 1,
): string {
  const scale = (points: number) => Math.round(points * multiplier * 100) / 100;
  const places = event.placePoints.map(
    (points, i) => `${ordinal(i + 1)} ${scale(points)}`,
  );
  return [...places, `others ${scale(event.minimumPoints)}`].join(' · ');
}

export function multiplierLabel(multiplier: number): string {
  return `${multiplier}×`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  return 'Something went wrong. Try again?';
}
