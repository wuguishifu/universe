import { Logger } from '@nestjs/common';

import { MarketAdapter } from './market-adapter';
import { eventSchema } from '../../types/event';

// Built as an array to allow for easy extension once polymarket adds other coins
const assets = ['btc'] as const;

const FIVE_MINUTES_S = 5 * 60;
const FIVE_MINUTES_MS = FIVE_MINUTES_S * 1000;

export class Crypto5mAdapter extends MarketAdapter {
  protected readonly logger = new Logger(Crypto5mAdapter.name);

  public readonly refreshIntervalMs = 5 * 60 * 1000; // 5:00
  public maxTimeRemainingMs = 4 * 60 * 1000; // 4:00
  public minTimeRemainingMs = 30 * 1000; // 1:00
  public stopLossTimeoutMs = 200_000; // 200 seconds — all good straddles empirically fill within 184s
  public stopLossMaxDropCents = 15; // 15c — catches all observed failures, 1 FP with 60s grace
  public stopLossGracePeriodMs = 30_000; // 30s — validated: zero false positives at 30s threshold
  public stopLossMinTimeRemainingMs = 45_000; // 45s — hard cutoff before resolution
  public stopLossConfirmationDelayMs = 12_000; // 12s confirmation window before executing price_drop stop loss
  public stopLossConfirmationFastVelocityThreshold = 0.5; // $/s — bypass confirmation delay above this adverse velocity
  public stopLossBtcDeltaMinDollars = 25; // $ — BTC must move ≥$25 from candle open before price_drop fires
  public straddleCooldownMs = 300_000; // 5 minutes
  public tradingStartHourUtc = 10; // 10:00 UTC (5am EST) — validated: loss rate drops from 67% to ~25% after this hour
  public tradingEndHourUtc = null; // no end restriction
  public tradingExcludeHoursUtcStart = 11; // exclude 11:00–13:59 UTC (London/NY handoff — elevated stop rate)
  public tradingExcludeHoursUtcEnd = 14;

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
