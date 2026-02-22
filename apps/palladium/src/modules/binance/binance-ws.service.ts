import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { OsmiumService, WebSocketService } from '@wuguishifu/nest-common';
import { BINANCE_COMBINED_WS_URL } from '@wuguishifu/utils-polymarket';

export type BinanceBookTick = {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  mid: number;
  timestamp: number;
};

export type BinanceKlineEvent = {
  symbol: string;
  openTime: number;   // candle open timestamp in ms (UTC)
  openPrice: number;  // price at the start of this candle
  isClosed: boolean;  // true once the candle is finalised
};

@Injectable()
export class BinanceWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(BinanceWsService.name);

  private readonly tickSubject = new Subject<BinanceBookTick>();
  public readonly ticks$ = this.tickSubject.asObservable();

  private readonly klineSubject = new Subject<BinanceKlineEvent>();
  public readonly klines$ = this.klineSubject.asObservable();

  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(private readonly osmiumService: OsmiumService) {
    super(BINANCE_COMBINED_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Binance WebSocket...');
    this.tickSubject.complete();
    this.klineSubject.complete();
    this.close();

    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  protected onError(error: Error): void {
    this.osmiumService.trackDebug({ name: 'binance_ws-error', metadata: { message: error.message } });
  }

  protected onClose(code: number, reason: string): void {
    this.osmiumService.trackDebug({ name: 'binance_ws-closed', metadata: { code, reason } });
  }

  protected handleMessage(data: WebSocket.Data): void {
    try {
      const raw = JSON.parse(data.toString());
      const streamName: string = raw.stream ?? '';
      const payload = raw.data ?? raw;
      const symbol = streamName.split('@')[0].replace(/usdt$/i, '').toUpperCase();

      if (streamName.includes('@kline')) {
        const k = payload.k;
        this.klineSubject.next({
          symbol,
          openTime: k.t,
          openPrice: parseFloat(k.o),
          isClosed: k.x,
        });
      } else {
        const bestBid = parseFloat(payload.b);
        const bestAsk = parseFloat(payload.a);
        this.tickSubject.next({
          symbol: symbol || payload.s,
          bestBid,
          bestAsk,
          mid: (bestBid + bestAsk) / 2,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to parse Binance WS message: ${error}`);
    }
  }

  private scheduleWatchdogReconnect() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      this.reconnect();
    }, 300_000);
  }

  protected onOpen(): void {
    this.scheduleWatchdogReconnect();
  }

  protected onPing(): void {
    this.scheduleWatchdogReconnect();
  }
}
