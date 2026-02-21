import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';
import { getTimeRemainingMs } from '@wuguishifu/utils-polymarket';

import { EnvironmentService } from '../../environment/environment-service';
import { CacheService } from '../cache/cache.service';
import { MarketWsService } from '../clob-ws/market-ws.service';
import { MarketAdapterService } from '../market-adapter/market-adapter.service';

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryService.name);

  private marketRefreshTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly cacheService: CacheService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly marketAdapterService: MarketAdapterService,
  ) {}

  public async onModuleInit() {
    await this.refreshMarkets();
    this.scheduleMarketRefresh();
  }

  public onModuleDestroy() {
    if (this.marketRefreshTimeout) {
      clearTimeout(this.marketRefreshTimeout);
      this.marketRefreshTimeout = null;
    }
  }

  public async refreshMarkets() {
    const markets = await this.marketAdapterService.adapter.fetchMarkets();

    markets.forEach((market) => this.cacheService.markets.set(market.conditionId, market));
    const now = Date.now();
    let staleCount = 0;
    for (const [key, market] of this.cacheService.markets.entries()) {
      if (getTimeRemainingMs(market, now) <= 0) {
        this.cacheService.markets.delete(key);
        staleCount++;
      }
    }

    const activeMarkets = Array.from(this.cacheService.markets.values());
    const tradableMarkets = activeMarkets.filter((market) => getTimeRemainingMs(market, now) > 0);
    this.marketWsService.syncSubscriptions(tradableMarkets);

    // ! In the future this may be a huge object, but for now since we only use 4 markets it's okay for now.
    this.osmiumService.trackEvent({
      name: 'discovery_service-markets-refreshed',
      metadata: { markets },
    });
    this.logger.debug(
      `Refreshed markets: ${markets.length} fetched, ${staleCount} expired, ${activeMarkets.length} active`,
    );
  }

  private scheduleMarketRefresh() {
    const now = Date.now();
    const refreshInterval = this.marketAdapterService.adapter.refreshIntervalMs;
    const nextInterval = Math.ceil(now / refreshInterval) * refreshInterval;
    const msUntilNextInterval = nextInterval - now;

    this.logger.debug(`Next refresh scheduled in ${Math.round(msUntilNextInterval / 1000)}s`);
    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'discovery_service-refresh-schedule',
        metadata: {
          msUntilNextInterval,
          timestamp: new Date(nextInterval).toISOString(),
        },
      });
    }

    this.marketRefreshTimeout = setTimeout(async () => {
      try {
        await this.refreshMarkets();
      } catch (error) {
        this.logger.error(`Failed to refresh markets: ${(error as Error).message}`);
      }
      this.scheduleMarketRefresh();
    }, msUntilNextInterval);
  }
}
