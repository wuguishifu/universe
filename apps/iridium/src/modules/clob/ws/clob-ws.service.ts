import { Injectable, Logger } from '@nestjs/common';
import { share, Subject } from 'rxjs';
import WebSocket from 'ws';

import { CLOB_WS_URL } from '../../../constants/constants';
import { BookMessage } from '../../../types/clob/bookMessage';
import { Message } from '../../../types/clob/message';
import { OrderMessage } from '../../../types/clob/orderMessage';
import { Market } from '../../../types/market';
import { parseOrderSummary } from '../../../utils/market.utils';
import { CacheService } from '../../cache/cache.service';

export type MarketTick = {
  marketId: string;
  yesAssetId: string;
  noAssetId: string;
  bestBidYes: number;
  bestBidNo: number;
  timestamp: number;
  timeRemaining: number;
};

const reconnectionDelays = [1000, 2000, 5000, 10000];

type MarketState = { [assetId: string]: number };

@Injectable()
export class ClobWsService {
  private readonly logger = new Logger(ClobWsService.name);

  private ws: WebSocket;
  private readonly queuedMessages: string[] = [];
  private reconnectionTimer: NodeJS.Timeout | null = null;
  private reconnectionAttempts = 0;

  private marketState = new Map<string, MarketState>();
  private readonly marketTickSubject = new Subject<MarketTick>();
  public readonly marketTicks$ = this.marketTickSubject.asObservable().pipe(share());

  private readonly orderUpdateSubject = new Subject<OrderMessage>();
  public readonly orderUpdates$ = this.orderUpdateSubject.asObservable();

  constructor(private readonly cacheService: CacheService) {
    this.ws = new WebSocket(CLOB_WS_URL);
    this.setupEventListeners();
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach((message) => {
        if (message.event_type === 'book') {
          this.processBookUpdate(message);
        } else if (message.event_type === 'order') {
          this.orderUpdateSubject.next(message);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to parse CLOB WS message: ${error}`);
    }
  }

  private processBookUpdate(message: BookMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      this.logger.warn(`Received book update for unknown market: ${message.market}`);
      return;
    }

    const bestBid = message.bids.length > 0 ? message.bids.map(parseOrderSummary).sort((a, b) => b[0] - a[0])[0][0] : 0;

    const state = this.getMarketState(message.market);
    state[message.asset_id] = bestBid;
    const assetIds = Object.keys(state);

    if (assetIds.length === 2) {
      this.marketTickSubject.next({
        marketId: message.market,
        yesAssetId: market.yesToken,
        noAssetId: market.noToken,
        bestBidYes: state[market.yesToken],
        bestBidNo: state[market.noToken],
        timestamp: parseInt(message.timestamp),
        timeRemaining: market.endDate.getTime() - Date.now(),
      });
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
    markets.forEach((market) => this.getMarketState(market.conditionId));
  }

  public unsubscribe(markets: Market[]) {
    this.logger.debug(`Scheduling unsubscription for ${markets.length} markets`);
    const tokenIds = markets.flatMap((market) => [market.noToken, market.yesToken]);
    this.send({ type: 'unsubscribe', channel: 'market', assets_ids: tokenIds });
    markets.forEach((market) => this.marketState.delete(market.conditionId));
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

  private getMarketState(marketId: string): MarketState {
    return (
      this.marketState.get(marketId) ??
      (() => {
        const state = {};
        this.marketState.set(marketId, state);
        return state;
      })()
    );
  }
}
