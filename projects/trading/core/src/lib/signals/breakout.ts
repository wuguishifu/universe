import { z } from 'zod';

import { priceOf, priceSourceSchema } from '../indicators/indicator';
import { Bar } from '../market/types';
import { Direction, IndicatorValues } from '../strategy/types';

import { SignalGenerator } from './signal';

export const breakoutConfigSchema = z.object({
  type: z.literal('breakout'),
  /** Indicator names. Bullish when price closes above `upper`, bearish when it closes below `lower`. */
  upper: z.string().min(1),
  lower: z.string().min(1),
  source: priceSourceSchema.default('close'),
  /** Stop signalling after this many breakouts in a session. Leave out for no limit. */
  maxPerSession: z.number().int().positive().optional(),
  /**
   * Signal on every bar that closes outside the band, not only the bar that crosses out. Pair it
   * with a time window to ask "is price outside the band at 15:00?"
   */
  whileOutside: z.boolean().default(false),
});
export type BreakoutConfig = z.infer<typeof breakoutConfigSchema>;

/**
 * Fires on the bar where price moves outside a band: above `upper` or below `lower`. It fires
 * again only after price has been back inside the band or broken out the other way, unless
 * `whileOutside` is set.
 *
 * Each session starts inside the band, so a bar that opens the session already outside counts.
 */
export class Breakout implements SignalGenerator {
  private readonly config: BreakoutConfig;
  private side: 1 | -1 | 0 = 0;
  private count = 0;

  constructor(config: BreakoutConfig) {
    this.config = config;
  }

  update(indicators: IndicatorValues, bar: Bar): Direction | null {
    const upper = indicators[this.config.upper];
    const lower = indicators[this.config.lower];
    if (upper === undefined || lower === undefined) return null;

    const price = priceOf(bar, this.config.source);
    const side = price > upper ? 1 : price < lower ? -1 : 0;
    const previous = this.side;
    this.side = side;
    if (side === 0 || (side === previous && !this.config.whileOutside))
      return null;

    const { maxPerSession } = this.config;
    if (maxPerSession !== undefined && this.count >= maxPerSession) return null;
    this.count += 1;
    return side === 1 ? 'bullish' : 'bearish';
  }

  startSession(): void {
    this.side = 0;
    this.count = 0;
  }
}
