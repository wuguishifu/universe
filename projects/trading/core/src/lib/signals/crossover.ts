import { z } from 'zod';

import { Direction, IndicatorValues } from '../strategy/types';

import { SignalGenerator } from './signal';

export const crossoverConfigSchema = z.object({
  type: z.literal('crossover'),
  /** Indicator name. Bullish when it crosses above `slow`, bearish when it crosses below. */
  fast: z.string().min(1),
  slow: z.string().min(1),
});
export type CrossoverConfig = z.infer<typeof crossoverConfigSchema>;

/**
 * Fires on the bar where `fast` moves to the other side of `slow`. Bars where the two are exactly
 * equal don't count as a side, so touching and bouncing back is not a cross.
 *
 * Each session starts with no side, so a gap overnight never registers as a cross on the first bar.
 */
export class Crossover implements SignalGenerator {
  private readonly config: CrossoverConfig;
  private side: 1 | -1 | 0 = 0;

  constructor(config: CrossoverConfig) {
    this.config = config;
  }

  update(indicators: IndicatorValues): Direction | null {
    const fast = indicators[this.config.fast];
    const slow = indicators[this.config.slow];
    if (fast === undefined || slow === undefined || fast === slow) return null;

    const side = fast > slow ? 1 : -1;
    const previous = this.side;
    this.side = side;
    if (previous === 0 || previous === side) return null;
    return side === 1 ? 'bullish' : 'bearish';
  }

  startSession(): void {
    this.side = 0;
  }
}
