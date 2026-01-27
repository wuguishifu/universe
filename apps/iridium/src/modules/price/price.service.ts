import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

import { CLOB_WS_URL } from '../../constants/constants';
import { Message } from '../../types/clob/message';
import { Market } from '../../types/market';
import { CacheService } from '../cache/cache.service';

const reconnectionDelays = [1000, 2000, 5000, 10000];

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private socket: WebSocket;
  private reconnectionAttempts = 0;
  private reconnectionTimer: NodeJS.Timeout | null = null;

  private queuedMessages: string[] = [];

  constructor(private readonly cacheService: CacheService) {
    this.socket = new WebSocket(CLOB_WS_URL);
    this.setupEventListeners();
  }

  public onModuleDestroy() {
    this.logger.debug('Closing CLOB WebSocket connection');
    this.socket.close();
  }

  private setupEventListeners() {
    this.socket.on('open', () => {
      this.logger.debug('WebSocket connected to CLOB');
      while (this.queuedMessages.length > 0) {
        const message = this.queuedMessages.shift();
        if (message) {
          this.socket.send(message);
        }
      }
    });

    this.socket.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.socket.on('error', (error) => {
      this.logger.error(`WebSocket error: ${error.message}`);
      this.socket.close();
      this.scheduleReconnect();
    });

    this.socket.on('close', (code, reason) => {
      this.logger.warn(`WebSocket closed: ${code} - ${reason}`);
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      const updatedTokenIds = new Set<string>();

      messages.forEach((message) => {
        if (message.event_type !== 'price_change') {
          // faster than filtering first and then forEaching
          return;
        }

        for (const change of message.price_changes) {
        }
      });

      for (const message of messages) {
        if (message.event_type !== 'price_change') {
          continue;
        }
      }

      console.log(JSON.stringify(messages, null, 2));
    } catch (error) {
      this.logger.error(`Failed to parse WebSocket message: ${error}`);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectionTimer) {
      return;
    }

    const delay = reconnectionDelays[Math.min(this.reconnectionAttempts, reconnectionDelays.length - 1)];
    this.logger.debug(`Scheduling WebSocket reconnection in ${delay} ms (attempt ${this.reconnectionAttempts + 1})`);

    this.reconnectionTimer = setTimeout(() => {
      this.reconnectionTimer = null;
      this.reconnectionAttempts++;
      this.socket = new WebSocket(CLOB_WS_URL);
      this.setupEventListeners();
    }, delay);
  }

  public subscribeToMarkets(markets: Market[]) {
    this.logger.debug(`Scheduling subscription for ${markets.length} markets`);
    const tokenIds = markets.flatMap((market) => [market.downToken, market.upToken]);
    const message = {
      type: 'subscribe',
      channel: 'market',
      assets_ids: tokenIds,
    };

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.logger.warn('WebSocket not ready, subscription will be queued');
      this.queuedMessages.push(JSON.stringify(message));
    }
  }

  public unsubscribeFromMarkets(markets: Market[]) {
    const tokenIds = markets.flatMap((market) => [market.downToken, market.upToken]);
    const message = {
      type: 'unsubscribe',
      channel: 'market',
      assets_ids: tokenIds,
    };

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.logger.warn('WebSocket not ready, unsubscription will be queued');
      this.queuedMessages.push(JSON.stringify(message));
    }
  }
}
