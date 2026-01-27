import { Injectable, Logger } from '@nestjs/common';

import { HttpService } from '@wuguishifu/nest-common';

import { GAMMA_API_BASE } from '../../constants/constants';
import { eventSchema } from '../../types/event';
import { Market } from '../../types/market';
import { generate1hSlug, getCurrentHourWindows, getTimeRemaining, HourWindow } from '../../utils/discovery.utils';
import { CacheService } from '../cache/cache.service';
import { PriceService } from '../price/price.service';

const assets = ['bitcoin', 'ethereum', 'solana', 'xrp'] as const;

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly httpService = new HttpService({ baseURL: GAMMA_API_BASE });

  constructor(
    private readonly priceService: PriceService,
    private readonly cacheService: CacheService,
  ) {
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
    const { current, next } = getCurrentHourWindows();

    const eventsPromises = assets.flatMap((asset) => [this.fetchEvent(asset, current), this.fetchEvent(asset, next)]);
    const events = await Promise.all(eventsPromises);
    const markets = events.flatMap((event) => event?.markets ?? []);
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

  private async fetchEvent(asset: string, window: HourWindow) {
    const slug = generate1hSlug(asset, window);
    const response = await this.httpService.get(`/events/slug/${slug}`);
    if (response.status === 200) {
      this.logger.debug(`Fetched event data for ${asset} in window ${window.timeSlug}`);

      const parsed = eventSchema.safeParse(response.data);
      if (!parsed.success) {
        this.logger.warn(`Invalid event data for ${asset} in window ${window.timeSlug}: ${parsed.error.message}`);
        return null;
      }

      return parsed.data;
    }

    this.logger.warn(`Failed to fetch event data for ${asset} in window ${window.timeSlug}`);
    return null;
  }
}
