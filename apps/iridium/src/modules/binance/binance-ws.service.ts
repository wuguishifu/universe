import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { WebSocketService } from '../../common/ws-service';
import { BINANCE_BTC_WS_URL } from '../../constants/constants';

export type BinanceBookTick = {
  symbol: string;
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
  mid: number;
  timestamp: number;
};

@Injectable()
export class BinanceWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(BinanceWsService.name);

  private readonly tickSubject = new Subject<BinanceBookTick>();
  public readonly ticks$ = this.tickSubject.asObservable();

  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor() {
    super(BINANCE_BTC_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Binance WebSocket...');
    this.tickSubject.complete();
    this.close();
  }

  protected handleMessage(data: WebSocket.Data): void {
    try {
      const raw = JSON.parse(data.toString());
      const bestBid = parseFloat(raw.b);
      const bestAsk = parseFloat(raw.a);

      this.tickSubject.next({
        symbol: raw.s,
        bestBid,
        bestBidQty: parseFloat(raw.B),
        bestAsk,
        bestAskQty: parseFloat(raw.A),
        mid: (bestBid + bestAsk) / 2,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error(`Failed to parse Binance WS message: ${error}`);
    }
  }

  private scheduleWatchdogReconnect() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }

    this.watchdogTimer = setInterval(() => {
      this.reconnect();
    }, 10_000);
  }

  protected onOpen(): void {
    this.scheduleWatchdogReconnect();
  }

  protected onPing(): void {
    this.scheduleWatchdogReconnect();
  }
}
