import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { WebSocketService } from './ws-service';
import { CLOB_MARKET_WS_URL } from '../../../constants/constants';
import { BookMessage } from '../../../types/clob/bookMessage';
import { Message } from '../../../types/clob/message';
import { TickSizeChangeMessage } from '../../../types/clob/tickSizeChangeMessage';
import { Market } from '../../../types/market';
import { parseOrderSummary } from '../../../utils/market.utils';
import { CacheService } from '../../cache/cache.service';

export type MarketTick = {
  conditionId: string;
  yesAssetId: string;
  noAssetId: string;
  bestBidYes: number;
  bestBidNo: number;
  timestamp: number;
  timeRemaining: number;
  timeElapsed: number;
  minTickSize: TickSize;
};

type MarketState = { [assetId: string]: number };

@Injectable()
export class MarketWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(MarketWsService.name);

  private marketState = new Map<string, MarketState>();
  private subscribedTokenIds = new Set<string>();
  private readonly marketTickSubject = new Subject<MarketTick>();
  public readonly marketTicks$ = this.marketTickSubject.asObservable();

  constructor(private readonly cacheService: CacheService) {
    super(CLOB_MARKET_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Market WebSocket...');
    this.marketTickSubject.complete();
    this.close();
  }

  protected onOpen(): void {
    if (this.subscribedTokenIds.size > 0) {
      this.logger.debug(`Market WebSocket reconnected, re-subscribing to ${this.subscribedTokenIds.size} tokens...`);
      this.send({ type: 'subscribe', channel: 'market', assets_ids: Array.from(this.subscribedTokenIds) });
    }
  }

  protected handleMessage(data: WebSocket.Data) {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach((message) => {
        switch (message.event_type) {
          case 'book':
            this.processBookUpdate(message);
            break;
          case 'tick_size_change':
            this.processTickSizeChange(message);
            break;
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
        conditionId: message.market,
        yesAssetId: market.yesToken,
        noAssetId: market.noToken,
        bestBidYes: state[market.yesToken],
        bestBidNo: state[market.noToken],
        timestamp: parseInt(message.timestamp),
        timeRemaining: market.endDate.getTime() - Date.now(),
        timeElapsed: Date.now() - market.eventStartTime.getTime(),
        minTickSize: market.orderPriceMinTickSize,
      });
    }
  }

  private processTickSizeChange(message: TickSizeChangeMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      this.logger.warn(`Received tick size change for unknown market: ${message.market}`);
      return;
    }

    market.orderPriceMinTickSize = message.new_tick_size;
  }

  public subscribe(markets: Market[]) {
    // Filter to only new tokens that aren't already subscribed
    const allTokenIds = markets.flatMap((market) => [market.noToken, market.yesToken]);
    const newTokenIds = allTokenIds.filter((id) => !this.subscribedTokenIds.has(id));

    if (newTokenIds.length === 0) {
      this.logger.debug(`All ${markets.length} markets already subscribed, skipping`);
      return;
    }

    this.logger.debug(`Subscribing to ${newTokenIds.length} new tokens (${markets.length} markets requested)`);
    newTokenIds.forEach((id) => this.subscribedTokenIds.add(id));
    this.send({ type: 'subscribe', channel: 'market', assets_ids: newTokenIds });
    markets.forEach((market) => this.getMarketState(market.conditionId));
  }

  public unsubscribe(markets: Market[]) {
    this.logger.debug(`Scheduling unsubscription for ${markets.length} markets`);
    const tokenIds = markets.flatMap((market) => [market.noToken, market.yesToken]);
    tokenIds.forEach((id) => this.subscribedTokenIds.delete(id));
    this.send({ type: 'unsubscribe', channel: 'market', assets_ids: tokenIds });
    markets.forEach((market) => this.marketState.delete(market.conditionId));
  }

  private getMarketState(conditionId: string): MarketState {
    return (
      this.marketState.get(conditionId) ??
      (() => {
        const state = {};
        this.marketState.set(conditionId, state);
        return state;
      })()
    );
  }
}
