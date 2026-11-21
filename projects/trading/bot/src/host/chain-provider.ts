import {
  ChainProvider,
  ChainRequest,
  nyTime,
  OptionContract,
} from '@projects/trading-core';

import { addDays } from './ny-clock';
import { parseOccSymbol } from './occ';
import { MarketData, OptionQuoteSnapshot } from './ports';
import { HostSettings } from './settings';

/**
 * Option chains from the broker's snapshots: strikes near the underlying, expirations in the next
 * few days, at the latest bid and ask. Contracts whose quote is older than `maxQuoteAgeMs` at the
 * decision time are left out, as if they had no market.
 */
export class SnapshotChainProvider implements ChainProvider {
  private readonly data: MarketData;
  private readonly settings: HostSettings;
  private readonly onChain: (
    request: ChainRequest,
    quotes: readonly OptionQuoteSnapshot[],
  ) => void;

  constructor(
    data: MarketData,
    settings: HostSettings,
    onChain: (
      request: ChainRequest,
      quotes: readonly OptionQuoteSnapshot[],
    ) => void = () => undefined,
  ) {
    this.data = data;
    this.settings = settings;
    this.onChain = onChain;
  }

  async getChain(request: ChainRequest): Promise<OptionContract[]> {
    const { date } = nyTime(request.time);
    const range = this.settings.chainStrikeRange;
    const quotes = await this.data.optionChain({
      underlying: request.underlying,
      type: request.type,
      expirationFrom: date,
      expirationTo: addDays(date, this.settings.chainMaxDays),
      strikeFrom: request.underlyingPrice - range,
      strikeTo: request.underlyingPrice + range,
      asOf: request.time,
    });
    this.onChain(request, quotes);

    const chain: OptionContract[] = [];
    for (const quote of quotes) {
      if (request.time - quote.time > this.settings.maxQuoteAgeMs) continue;
      const occ = parseOccSymbol(quote.symbol);
      if (
        !occ ||
        occ.underlying !== request.underlying ||
        occ.type !== request.type
      )
        continue;
      chain.push({
        symbol: quote.symbol,
        ...occ,
        bid: quote.bid,
        ask: quote.ask,
      });
    }
    return chain;
  }
}
