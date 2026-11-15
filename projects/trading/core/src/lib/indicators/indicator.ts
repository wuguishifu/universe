import { z } from 'zod';

import { Bar } from '../market/types';

export interface Indicator {
  /** Feeds one closed bar. Returns the value after it, or undefined while still warming up. */
  update(bar: Bar): number | undefined;
  readonly value: number | undefined;
  /** Called before the first bar of each trading session. */
  startSession(): void;
}

export const priceSourceSchema = z.enum([
  'open',
  'high',
  'low',
  'close',
  'hl2',
  'hlc3',
  'ohlc4',
]);
export type PriceSource = z.infer<typeof priceSourceSchema>;

export function priceOf(bar: Bar, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
  }
}
