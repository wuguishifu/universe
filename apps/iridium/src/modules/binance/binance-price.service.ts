import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { BinanceBookTick, BinanceWsService } from './binance-ws.service';

type PriceHistoryEntry = {
  mid: number;
  timestamp: number;
};

export type BtcPriceSnapshot = {
  currentPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  priceChangeDollars: number | null;
  velocityPerSecond: number | null;
  accelerationPerSecond2: number | null;
  msSinceLastTick: number | null;
  historyLength: number;
};

const HISTORY_WINDOW_MS = 60_000;

@Injectable()
export class BinancePriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinancePriceService.name);

  private readonly priceHistory: PriceHistoryEntry[] = [];
  private lastTick: BinanceBookTick | null = null;
  private subscription: Subscription | null = null;

  constructor(private readonly binanceWsService: BinanceWsService) {}

  onModuleInit() {
    this.subscription = this.binanceWsService.ticks$.subscribe((tick) => {
      this.lastTick = tick;
      this.priceHistory.push({ mid: tick.mid, timestamp: tick.timestamp });
      this.pruneOldEntries(tick.timestamp);
    });
    this.logger.debug('Subscribed to Binance BTC price feed');
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.priceHistory.length = 0;
    this.lastTick = null;
  }

  getSnapshot(): BtcPriceSnapshot {
    const history = this.priceHistory;
    const len = history.length;

    if (len === 0 || !this.lastTick) {
      return {
        currentPrice: null,
        bestBid: null,
        bestAsk: null,
        priceChangeDollars: null,
        velocityPerSecond: null,
        accelerationPerSecond2: null,
        msSinceLastTick: null,
        historyLength: 0,
      };
    }

    const newest = history[len - 1];
    const oldest = history[0];
    const windowMs = newest.timestamp - oldest.timestamp;

    const priceChangeDollars = newest.mid - oldest.mid;
    const velocityPerSecond = windowMs > 0 ? (priceChangeDollars / windowMs) * 1000 : null;

    let accelerationPerSecond2: number | null = null;
    if (len >= 4 && windowMs > 0) {
      const midIdx = Math.floor(len / 2);
      const firstHalfOldest = oldest;
      const firstHalfNewest = history[midIdx - 1];
      const secondHalfOldest = history[midIdx];
      const secondHalfNewest = newest;

      const firstWindowMs = firstHalfNewest.timestamp - firstHalfOldest.timestamp;
      const secondWindowMs = secondHalfNewest.timestamp - secondHalfOldest.timestamp;

      if (firstWindowMs > 0 && secondWindowMs > 0) {
        const v1 = ((firstHalfNewest.mid - firstHalfOldest.mid) / firstWindowMs) * 1000;
        const v2 = ((secondHalfNewest.mid - secondHalfOldest.mid) / secondWindowMs) * 1000;
        const dtSeconds =
          ((secondHalfOldest.timestamp + secondHalfNewest.timestamp) / 2 -
            (firstHalfOldest.timestamp + firstHalfNewest.timestamp) / 2) /
          1000;

        if (dtSeconds > 0) {
          accelerationPerSecond2 = (v2 - v1) / dtSeconds;
        }
      }
    }

    return {
      currentPrice: this.lastTick.mid,
      bestBid: this.lastTick.bestBid,
      bestAsk: this.lastTick.bestAsk,
      priceChangeDollars,
      velocityPerSecond,
      accelerationPerSecond2,
      msSinceLastTick: Date.now() - this.lastTick.timestamp,
      historyLength: len,
    };
  }

  private pruneOldEntries(now: number) {
    const cutoff = now - HISTORY_WINDOW_MS;
    const idx = this.priceHistory.findIndex((h) => h.timestamp >= cutoff);
    if (idx === -1) {
      if (this.priceHistory.length > 0) {
        this.priceHistory.length = 0;
      }
    } else if (idx > 0) {
      this.priceHistory.splice(0, idx);
    }
  }
}
