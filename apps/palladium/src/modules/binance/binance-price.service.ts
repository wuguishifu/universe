import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { BinanceBookTick, BinanceWsService } from './binance-ws.service';

type PriceSnapshot = {
  currentPrice: number | null;
  msSinceLastTick: number | null;
};

@Injectable()
export class BinancePriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinancePriceService.name);

  private readonly lastTick = new Map<string, BinanceBookTick>();
  private subscription: Subscription | null = null;

  constructor(private readonly binanceWsService: BinanceWsService) {}

  onModuleInit() {
    this.subscription = this.binanceWsService.ticks$.subscribe((tick) => {
      this.lastTick.set(tick.symbol, tick);
    });
    this.logger.debug('Subscribed to Binance multi-symbol price feed');
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.lastTick.clear();
  }

  getSnapshot(symbol: string): PriceSnapshot {
    const tick = this.lastTick.get(symbol) ?? null;
    if (!tick) {
      return { currentPrice: null, msSinceLastTick: null };
    }
    return {
      currentPrice: tick.mid,
      msSinceLastTick: Date.now() - tick.timestamp,
    };
  }
}
