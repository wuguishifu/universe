import { Injectable, Logger } from '@nestjs/common';

import { MarketAdapter } from './market-adapters/adapter';
import { CryptoAdapter } from './market-adapters/crypto.adapter';
import { Market } from '../../types/market';
import { getTimeRemainingMs } from '../../utils/market.utils';
import { CacheService } from '../cache/cache.service';
import { MarketWsService } from '../clob/ws/market-ws.service';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly marketAdapter: MarketAdapter;

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly cacheService: CacheService,
  ) {
    this.marketAdapter = new CryptoAdapter();
    this.refreshMarkets();

    setInterval(
      () => {
        this.refreshMarkets();
        this.cleanStaleMarkets();
      },
      5 * 60 * 1000,
    );
  }

  public async refreshMarkets() {
    const markets = await this.marketAdapter.fetchMarkets();
    markets.forEach((market) => this.cacheService.markets.set(market.conditionId, market));

    this.marketWsService.subscribe(markets);
    this.logger.debug(`Refreshed ${markets.length} markets in discovery cache`);
  }

  private cleanStaleMarkets() {
    const now = Date.now();
    const cleared: Market[] = [];
    for (const [key, market] of this.cacheService.markets.entries()) {
      const timeRemaining = getTimeRemainingMs(market, now);
      if (timeRemaining <= 0) {
        this.cacheService.markets.delete(key);
        cleared.push(market);
      }
    }

    this.marketWsService.unsubscribe(cleared);
    this.logger.debug(`Cleaned up ${cleared.length} stale markets from discovery cache`);
  }
}
