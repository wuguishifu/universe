import { Logger } from '@nestjs/common';

import { eventSchema } from '@wuguishifu/utils-polymarket';

import { MarketAdapter } from './market-adapter';

// Built as an array to allow for easy extension once polymarket adds other coins
const assets = ['btc', 'eth', 'sol', 'xrp'] as const;

const FIVE_MINUTES_S = 5 * 60;
const FIVE_MINUTES_MS = FIVE_MINUTES_S * 1000;

export class Crypto5mAdapter extends MarketAdapter {
  protected readonly logger = new Logger(Crypto5mAdapter.name);

  public readonly refreshIntervalMs = FIVE_MINUTES_MS;

  async fetchMarkets() {
    const windowTimestamp = Math.floor(Date.now() / FIVE_MINUTES_MS) * FIVE_MINUTES_S;
    const slugs = assets.map((asset) => `${asset}-updown-5m-${windowTimestamp}`);
    const events = await Promise.all(
      slugs.map(async (slug) => {
        const response = await this.httpService.get(`/events/slug/${slug}`);
        if (response.status === 200) {
          this.logger.debug(`Fetched market data for ${slug}`);
          const parsed = eventSchema.safeParse(response.data);
          if (!parsed.success) {
            this.logger.warn(`Invalid event data for ${slug}: ${parsed.error.message}`);
            return null;
          }
          return parsed.data;
        }
      }),
    );

    return events.flatMap((event) => event?.markets ?? []);
  }
}
