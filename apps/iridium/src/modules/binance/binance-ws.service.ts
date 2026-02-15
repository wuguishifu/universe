import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { OsmiumService } from '@wuguishifu/nest-common';

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

  constructor(private readonly osmiumService: OsmiumService) {
    super(BINANCE_BTC_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Binance WebSocket...');
    this.tickSubject.complete();
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
