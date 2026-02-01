import { Injectable, Logger } from '@nestjs/common';
import { share, Subject } from 'rxjs';
import WebSocket from 'ws';

import { CLOB_WS_URL } from '../../../constants/constants';
import { Message } from '../../../types/clob/message';
import { PriceChangeMessage } from '../../../types/clob/priceChangeMessage';
import { Market } from '../../../types/market';

const reconnectionDelays = [1000, 2000, 5000, 10000];

@Injectable()
export class ClobWsService {
  private readonly logger = new Logger(ClobWsService.name);

  private ws: WebSocket;
  private readonly queuedMessages: string[] = [];
  private reconnectionTimer: NodeJS.Timeout | null = null;
  private reconnectionAttempts = 0;

  private readonly priceSubject = new Subject<PriceChangeMessage>();
  public readonly priceUpdates$ = this.priceSubject.asObservable().pipe(share());

  constructor() {
    this.ws = new WebSocket(CLOB_WS_URL);
    this.setupEventListeners();
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach((message) => {
        if (message.event_type === 'price_change') {
          this.priceSubject.next(message);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to parse CLOB WS message: ${error}`);
    }
  }

  private setupEventListeners() {
    this.ws.on('open', () => {
      this.reconnectionAttempts = 0;

      this.logger.debug('CLOB WebSocket connected');
      while (this.queuedMessages.length > 0) {
        const message = this.queuedMessages.shift();
        if (message) {
          this.ws.send(message);
        }
      }
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      this.logger.error(`CLOB WebSocket error: ${error.message}`);
      this.ws.close();
    });

    this.ws.on('close', (code, reason) => {
      this.logger.warn(`CLOB WebSocket closed: ${code} - ${reason}`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectionTimer) {
      return;
    }

    const delay = reconnectionDelays[Math.min(this.reconnectionAttempts, reconnectionDelays.length - 1)];
    this.logger.debug(`Reconnecting to CLOB WebSocket in ${delay} ms`);
    this.reconnectionTimer = setTimeout(() => {
      this.reconnectionAttempts++;
      this.reconnectionTimer = null;
      this.ws = new WebSocket(CLOB_WS_URL);
      this.setupEventListeners();
    }, delay);
  }

  public subscribe(markets: Market[]) {
    this.logger.debug(`Scheduling subscription for ${markets.length} markets`);
    const tokenIds = markets.flatMap((market) => [market.noToken, market.yesToken]);
    this.send({ type: 'subscribe', channel: 'market', assets_ids: tokenIds });
  }

  public unsubscribe(markets: Market[]) {
    this.logger.debug(`Scheduling unsubscription for ${markets.length} markets`);
    const tokenIds = markets.flatMap((market) => [market.noToken, market.yesToken]);
    this.send({ type: 'unsubscribe', channel: 'market', assets_ids: tokenIds });
  }

  private send(message: unknown) {
    const payload = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.logger.debug('Buffering message (WS not ready)');
      this.queuedMessages.push(payload);
    }
  }
}
