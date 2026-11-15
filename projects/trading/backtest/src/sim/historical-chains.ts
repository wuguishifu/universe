import {
  Bar,
  ChainProvider,
  ChainRequest,
  MINUTE_MS,
  OptionContract,
} from '@projects/trading-core';

import { parseOccSymbol } from '../data/alpaca';

import { modelQuote } from './quotes';
import { SimulationConfig } from './simulation-config';

type Series = { contract: Omit<OptionContract, 'bid' | 'ask'>; bars: Bar[] };

/**
 * Serves option chains from one day of historical option bars. Each contract is priced from its
 * last bar that had closed by the request time, so nothing from the future leaks in. Contracts
 * that haven't traded within `maxPriceAgeMinutes` are left out, as if they had no market.
 */
export class HistoricalChains implements ChainProvider {
  private readonly simulation: SimulationConfig;
  private readonly series = new Map<string, Series[]>();

  constructor(simulation: SimulationConfig) {
    this.simulation = simulation;
  }

  /** Replaces the day's data for one underlying. */
  load(underlying: string, barsBySymbol: ReadonlyMap<string, Bar[]>): void {
    const series: Series[] = [];
    for (const [symbol, bars] of barsBySymbol) {
      const parsed = parseOccSymbol(symbol);
      if (!parsed || parsed.underlying !== underlying || bars.length === 0)
        continue;
      series.push({ contract: { symbol, ...parsed }, bars });
    }
    this.series.set(underlying, series);
  }

  getChain({
    underlying,
    type,
    time,
  }: ChainRequest): Promise<OptionContract[]> {
    const maxAge = this.simulation.maxPriceAgeMinutes * MINUTE_MS;
    const chain: OptionContract[] = [];
    for (const { contract, bars } of this.series.get(underlying) ?? []) {
      if (contract.type !== type) continue;
      const bar = lastClosedBar(bars, time);
      if (!bar || time - (bar.time + MINUTE_MS) > maxAge) continue;
      const { bid, ask } = modelQuote(bar.close, this.simulation);
      chain.push({ ...contract, bid, ask });
    }
    return Promise.resolve(chain);
  }
}

/** The last bar that ended at or before `time`. Bars must be sorted by time. */
export function lastClosedBar(
  bars: readonly Bar[],
  time: number,
): Bar | undefined {
  let lo = 0;
  let hi = bars.length - 1;
  let found: Bar | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bar = bars[mid];
    if (!bar) break;
    if (bar.time + MINUTE_MS <= time) {
      found = bar;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
