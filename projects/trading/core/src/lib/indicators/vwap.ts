import { z } from 'zod';

import { Bar } from '../market/types';

import { Indicator, priceOf, priceSourceSchema } from './indicator';

export const vwapConfigSchema = z.object({
  type: z.literal('vwap'),
  source: priceSourceSchema.default('ohlc4'),
});
export type VwapConfig = z.infer<typeof vwapConfigSchema>;

/** Volume-weighted average price, anchored to the start of each session. */
export class Vwap implements Indicator {
  private readonly config: VwapConfig;
  private priceVolume = 0;
  private volume = 0;
  private current: number | undefined;

  constructor(config: VwapConfig) {
    this.config = config;
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    this.priceVolume += priceOf(bar, this.config.source) * bar.volume;
    this.volume += bar.volume;
    this.current = this.volume > 0 ? this.priceVolume / this.volume : undefined;
    return this.current;
  }

  startSession(): void {
    this.priceVolume = 0;
    this.volume = 0;
    this.current = undefined;
  }
}
