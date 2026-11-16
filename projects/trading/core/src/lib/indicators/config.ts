import { z } from 'zod';

import { Ema, emaConfigSchema } from './ema';
import { Indicator } from './indicator';
import { Resampled } from './resampled';
import {
  NoiseBand,
  noiseBandConfigSchema,
  OpeningRange,
  openingRangeConfigSchema,
  Price,
  priceConfigSchema,
  TimeRange,
  timeRangeConfigSchema,
} from './session-levels';
import { Vwap, vwapConfigSchema } from './vwap';

// To add an indicator: write a class implementing `Indicator` with its own config schema,
// then add the schema here and a case to `createIndicator`.
export const indicatorConfigSchema = z.discriminatedUnion('type', [
  emaConfigSchema,
  vwapConfigSchema,
  priceConfigSchema,
  openingRangeConfigSchema,
  noiseBandConfigSchema,
  timeRangeConfigSchema,
]);
export type IndicatorConfig = z.infer<typeof indicatorConfigSchema>;

/** `inputMinutes` is the strategy's timeframe: the length of the bars the indicator is fed. */
export function createIndicator(
  config: IndicatorConfig,
  inputMinutes = 1,
): Indicator {
  switch (config.type) {
    case 'ema': {
      const ema = new Ema(config);
      const minutes = config.timeframeMinutes;
      return minutes !== undefined && minutes !== inputMinutes
        ? new Resampled(ema, minutes, inputMinutes)
        : ema;
    }
    case 'vwap':
      return new Vwap(config);
    case 'price':
      return new Price(config);
    case 'openingRange':
      return new OpeningRange(config);
    case 'noiseBand':
      return new NoiseBand(config);
    case 'timeRange':
      return new TimeRange(config);
  }
}

/** The bar length an indicator runs on, when it differs from the strategy's. */
export function indicatorTimeframe(
  config: IndicatorConfig,
): number | undefined {
  return config.type === 'ema' ? config.timeframeMinutes : undefined;
}
