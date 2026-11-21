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

export function describeScoring(event: {
  placePoints: number[];
  minimumPoints: number;
}): string {
  const places = event.placePoints.map(
    (points, i) => `${ordinal(i + 1)} ${points}`,
  );
  return [...places, `others ${event.minimumPoints}`].join(' · ');
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  return 'Something went wrong. Try again?';
}
