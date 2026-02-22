import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { BinanceBookTick, BinanceWsService } from './binance-ws.service';

export type PriceSnapshot = {
  currentPrice: number | null;
  msSinceLastTick: number | null;
};

export type CandleSnapshot = {
  openPrice: number;
  openTime: number;
};

@Injectable()
export class BinancePriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinancePriceService.name);

  private readonly lastTick = new Map<string, BinanceBookTick>();
  private readonly currentCandle = new Map<string, CandleSnapshot>();
  private readonly subscriptions: Subscription[] = [];

  constructor(private readonly binanceWsService: BinanceWsService) {}

  onModuleInit() {
    this.subscriptions.push(
      this.binanceWsService.ticks$.subscribe((tick) => {
        this.lastTick.set(tick.symbol, tick);
      }),
      this.binanceWsService.klines$.subscribe((kline) => {
        this.currentCandle.set(kline.symbol, {
          openPrice: kline.openPrice,
          openTime: kline.openTime,
        });
      }),
    );
    this.logger.debug('Subscribed to Binance book tickers and 5m klines');
  }

  onModuleDestroy() {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.lastTick.clear();
    this.currentCandle.clear();
  }

  getSnapshot(symbol: string): PriceSnapshot {
    const tick = this.lastTick.get(symbol) ?? null;
    if (!tick) return { currentPrice: null, msSinceLastTick: null };
    return {
      currentPrice: tick.mid,
      msSinceLastTick: Date.now() - tick.timestamp,
    };
  }

  /**
   * Returns the open price of the current 5m candle for the given symbol.
   * This is the Binance price at the start of the candle period, which should
   * align with the Polymarket market's eventStartTime.
   *
   * Returns null if no kline data has been received yet (e.g. bot just started).
   */
  getCandleOpen(symbol: string): CandleSnapshot | null {
    return this.currentCandle.get(symbol) ?? null;
  }
}
