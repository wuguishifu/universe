import { Bar } from './types';

/**
 * The prices to replay from one historical option bar. A bar doesn't say whether its low or its
 * high came first, so assume the worst for a bought option: down to the low, then up to the high.
 * A stop and a profit target inside the same bar then resolve as the stop.
 */
export function worstCasePricePath(bar: Bar): [number, number, number, number] {
  return [bar.open, bar.low, bar.high, bar.close];
}
