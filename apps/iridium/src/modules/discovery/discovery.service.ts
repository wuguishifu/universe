import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { MarketAdapter } from './market-adapters/adapter';
import { CryptoAdapter } from './market-adapters/crypto.adapter';
import { EnvironmentService } from '../../environment/environment-service';
import { Market } from '../../types/market';
import { getTimeRemainingMs } from '../../utils/market.utils';
import { CacheService } from '../cache/cache.service';
import { MarketWsService } from '../clob/ws/market-ws.service';

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly marketAdapter: MarketAdapter;

  private hourlyRefreshTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly cacheService: CacheService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {
    this.marketAdapter = new CryptoAdapter();
  }

  public async onModuleInit() {
    await this.refreshMarkets();
    this.scheduleHourlyRefresh();
  }

  public onModuleDestroy() {
    if (this.hourlyRefreshTimeout) {
      clearTimeout(this.hourlyRefreshTimeout);
      this.hourlyRefreshTimeout = null;
    }
  }

  public async refreshMarkets() {
    const markets = await this.marketAdapter.fetchMarkets();
    markets.forEach((market) => this.cacheService.markets.set(market.conditionId, market));
    this.osmiumService.trackEvent({
      name: 'discovery_service-markets-refreshed',
      metadata: { markets },
    });

    this.marketWsService.subscribe(markets);
    this.logger.debug(`Refreshed ${markets.length} markets in discovery cache`);
  }

  private scheduleHourlyRefresh() {
    const now = Date.now();
    const nextHour = Math.ceil(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const msUntilNextHour = nextHour - now + 1000; // 1s buffer for market data to settle

    this.logger.debug(`Next hourly refresh scheduled in ${Math.round(msUntilNextHour / 1000)}s`);
    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'discovery_service-hourly_refresh-schedule',
        metadata: {
          msUntilNextHour,
          timestamp: new Date(nextHour).toISOString(),
        },
      });
    }

    this.hourlyRefreshTimeout = setTimeout(async () => {
      try {
        this.cleanStaleMarkets();
        await this.refreshMarkets();
      } catch (error) {
        this.logger.error(`Failed hourly market refresh: ${error}`);
      }
      this.scheduleHourlyRefresh();
    }, msUntilNextHour);
  }

  private cleanStaleMarkets() {
    const now = Date.now();
    const cleared: Market[] = [];
    for (const [, market] of this.cacheService.markets.entries()) {
      const timeRemaining = getTimeRemainingMs(market, now);
      if (timeRemaining <= 0) {
        cleared.push(market);
      }
    }

    // Unsubscribe first so WS stops delivering updates before we remove from cache
    this.marketWsService.unsubscribe(cleared);
    cleared.forEach((market) => this.cacheService.markets.delete(market.conditionId));
    this.logger.debug(`Cleaned up ${cleared.length} stale markets from discovery cache`);
  }
}
