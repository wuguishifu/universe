import { z } from 'zod';

import { Ema, emaConfigSchema } from './ema';
import { Indicator } from './indicator';
import { Vwap, vwapConfigSchema } from './vwap';

// To add an indicator: write a class implementing `Indicator` with its own config schema,
// then add the schema here and a case to `createIndicator`.
export const indicatorConfigSchema = z.discriminatedUnion('type', [
  emaConfigSchema,
  vwapConfigSchema,
]);
export type IndicatorConfig = z.infer<typeof indicatorConfigSchema>;

export function createIndicator(config: IndicatorConfig): Indicator {
  switch (config.type) {
    case 'ema':
      return new Ema(config);
    case 'vwap':
      return new Vwap(config);
  }
}
