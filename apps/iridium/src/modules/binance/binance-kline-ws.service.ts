import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { OsmiumService } from '@wuguishifu/nest-common';

import { WebSocketService } from '../../common/ws-service';
import { BINANCE_BTC_KLINE_5M_WS_URL } from '../../constants/constants';

export type BinanceKlineTick = {
  openPrice: number;
  isClosed: boolean;
  openTime: number;
};

@Injectable()
export class BinanceKlineWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(BinanceKlineWsService.name);

  private readonly tickSubject = new Subject<BinanceKlineTick>();
  public readonly ticks$ = this.tickSubject.asObservable();

  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(private readonly osmiumService: OsmiumService) {
    super(BINANCE_BTC_KLINE_5M_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Binance kline WebSocket...');
    this.tickSubject.complete();
    this.close();

    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  protected onError(error: Error): void {
    this.osmiumService.trackDebug({ name: 'binance_kline_ws-error', metadata: { message: error.message } });
  }

  protected onClose(code: number, reason: string): void {
    this.osmiumService.trackDebug({ name: 'binance_kline_ws-closed', metadata: { code, reason } });
  }

  protected handleMessage(data: WebSocket.Data): void {
    try {
      const raw = JSON.parse(data.toString());
      const k = raw.k;
      this.tickSubject.next({
        openPrice: parseFloat(k.o),
        isClosed: k.x,
        openTime: k.t,
      });
    } catch (error) {
      this.logger.error(`Failed to parse Binance kline WS message: ${error}`);
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
