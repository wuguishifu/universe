import { ChainProvider, ChainRequest } from '../lib/engine/types';
import { MINUTE_MS, nyTime } from '../lib/market/ny-time';
import { Bar, OptionContract } from '../lib/market/types';
import { Position } from '../lib/strategy/types';

/** Epoch ms for a New York wall-clock time. Dates must be in standard time (EST, UTC-5). */
export const at = (date: string, hhmm: string): number =>
  Date.parse(`${date}T${hhmm}:00-05:00`);

/** A Monday in standard time. */
export const DAY = '2026-11-16';
export const NEXT_DAY = '2026-11-17';

export const bar = (
  time: number,
  close: number,
  partial: Partial<Bar> = {},
): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000,
  ...partial,
});

/** Flat 1-minute bars, one per price, starting at `start`. */
export const minuteBars = (start: number, prices: readonly number[]): Bar[] =>
  prices.map((price, i) => bar(start + i * MINUTE_MS, price));

export const contract = (
  partial: Partial<OptionContract> = {},
): OptionContract => ({
  symbol: 'SPY261117C00100000',
  underlying: 'SPY',
  type: 'call',
  strike: 100,
  expiration: NEXT_DAY,
  bid: 1,
  ask: 1.04,
  ...partial,
});

export const position = (partial: Partial<Position> = {}): Position => ({
  id: 'p1',
  ticker: 'SPY',
  direction: 'bullish',
  contract: contract(),
  status: 'open',
  qty: 1,
  entryPrice: 1,
  entryTime: at(DAY, '10:00'),
  entryDate: DAY,
  entryBarIndex: 10,
  mark: 1,
  peakMark: 1,
  ...partial,
});

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** Whole-dollar strikes ±5 around the underlying, expiring today and tomorrow, quoted 1.00 / 1.04. */
export class FakeChains implements ChainProvider {
  readonly requests: ChainRequest[] = [];

  getChain(request: ChainRequest): Promise<OptionContract[]> {
    this.requests.push(request);
    const today = nyTime(request.time).date;
    const center = Math.round(request.underlyingPrice);
    const contracts: OptionContract[] = [];
    for (const expiration of [today, addDays(today, 1)]) {
      for (let strike = center - 5; strike <= center + 5; strike++) {
        contracts.push(
          contract({
            symbol: `${request.underlying}-${expiration}-${request.type}-${strike}`,
            underlying: request.underlying,
            type: request.type,
            strike,
            expiration,
          }),
        );
      }
    }
    return Promise.resolve(contracts);
  }
}
