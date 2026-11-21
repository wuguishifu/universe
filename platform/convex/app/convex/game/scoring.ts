import type { Doc } from '../_generated/dataModel';

export type ScoringConfig = Pick<
  Doc<'gameEvents'>,
  'placePoints' | 'minimumPoints'
>;

export function pointsForPlace(event: ScoringConfig, place: number): number {
  return event.placePoints[place - 1] ?? event.minimumPoints;
}

/** Standard competition ranking: totals of 10, 10, 7 rank 1, 1, 3. Expects `sorted` desc by total. */
export function withRanks<T extends { total: number }>(
  sorted: T[],
): (T & { rank: number })[] {
  let rank = 0;
  let previous: number | undefined;
  return sorted.map((entry, i) => {
    if (entry.total !== previous) rank = i + 1;
    previous = entry.total;
    return { ...entry, rank };
  });
}
