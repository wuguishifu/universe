import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { MarketAdapter } from './market-adapters/adapter';
import { CryptoAdapter } from './market-adapters/crypto.adapter';
import { EnvironmentService } from '../../environment/environment-service';
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
    const now = Date.now();
    let staleCount = 0;
    for (const [key, market] of this.cacheService.markets.entries()) {
      if (getTimeRemainingMs(market, now) <= 0) {
        this.cacheService.markets.delete(key);
        staleCount++;
      }
    }

    const activeMarkets = Array.from(this.cacheService.markets.values());
    this.marketWsService.syncSubscriptions(activeMarkets);

    this.osmiumService.trackEvent({
      name: 'discovery_service-markets-refreshed',
      metadata: { markets },
    });
    this.logger.debug(
      `Refreshed markets: ${markets.length} fetched, ${staleCount} expired, ${activeMarkets.length} active`,
    );
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
        await this.refreshMarkets();
      } catch (error) {
        this.logger.error(`Failed hourly market refresh: ${error}`);
      }
      this.scheduleHourlyRefresh();
    }, msUntilNextHour);
  }
}
