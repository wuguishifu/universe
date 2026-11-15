import { z } from 'zod';

import { Bar } from '../market/types';

import { Indicator, priceOf, priceSourceSchema } from './indicator';

export const emaConfigSchema = z.object({
  type: z.literal('ema'),
  length: z.number().int().positive(),
  source: priceSourceSchema.default('close'),
  /**
   * `carryOver` keeps one continuous EMA across days, as TradingView does.
   * `resetDaily` starts over each session, so there is no value for the first `length` bars of a day.
   */
  warmup: z.enum(['carryOver', 'resetDaily']).default('carryOver'),
});
export type EmaConfig = z.infer<typeof emaConfigSchema>;

/**
 * Exponential moving average, seeded with the simple average of the first `length` bars.
 * With `carryOver` and a few days of warmup the seed has decayed away, so values line up with
 * TradingView's regardless of how it seeds.
 */
export class Ema implements Indicator {
  private readonly config: EmaConfig;
  private readonly alpha: number;
  private seedSum = 0;
  private seedCount = 0;
  private current: number | undefined;

  constructor(config: EmaConfig) {
    this.config = config;
    this.alpha = 2 / (config.length + 1);
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    const price = priceOf(bar, this.config.source);
    if (this.current === undefined) {
      this.seedSum += price;
      this.seedCount += 1;
      if (this.seedCount === this.config.length) {
        this.current = this.seedSum / this.config.length;
      }
    } else {
      this.current = this.alpha * price + (1 - this.alpha) * this.current;
    }
    return this.current;
  }

  startSession(): void {
    if (this.config.warmup === 'resetDaily') {
      this.seedSum = 0;
      this.seedCount = 0;
      this.current = undefined;
    }
  }
}
