import { Injectable, Logger } from '@nestjs/common';

import { Market } from '../../types/market';
import { getTimeRemaining } from '../../utils/discovery.utils';
import { CacheService } from '../cache/cache.service';
import { PriceService } from '../price/price.service';
import { CryptoAdapter } from './adapters/crypto.adapter';
import { MarketAdapter } from './adapters/marketAdapter';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly marketAdapter: MarketAdapter;

  constructor(
    private readonly priceService: PriceService,
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
    markets.forEach((market) => this.cacheService.markets.set(market.cacheKey, market));

    this.priceService.subscribeToMarkets(markets);
    this.logger.debug(`Refreshed ${markets.length} markets in discovery cache`);
  }

  private cleanStaleMarkets() {
    const now = new Date();
    const unsubscribed: Market[] = [];
    for (const [key, market] of this.cacheService.markets.entries()) {
      const timeRemaining = getTimeRemaining(market, now);
      if (timeRemaining <= 0) {
        this.cacheService.markets.delete(key);
        unsubscribed.push(market);
      }
    }

    this.priceService.unsubscribeFromMarkets(unsubscribed);
    this.logger.debug(`Cleaned up ${unsubscribed.length} stale markets from discovery cache`);
  }
}
