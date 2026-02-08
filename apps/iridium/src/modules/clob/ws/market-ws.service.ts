import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { WebSocketService } from './ws-service';
import { CLOB_MARKET_WS_URL } from '../../../constants/constants';
import { BookMessage } from '../../../types/clob/bookMessage';
import { LastTradePriceMessage } from '../../../types/clob/lastTradePriceMessage';
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
  minTickSize: TickSize;
  yesBidVolume?: number;
  yesAskVolume?: number;
  noBidVolume?: number;
  noAskVolume?: number;
};

export type TradeEvent = {
  conditionId: string;
  assetId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
};

type AssetState = {
  bestBid: number;
  totalBidVolume: number;
  totalAskVolume: number;
};

type MarketState = { [assetId: string]: AssetState };

@Injectable()
export class MarketWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(MarketWsService.name);

  private marketState = new Map<string, MarketState>();
  private subscribedTokenIds = new Set<string>();
  private readonly marketTickSubject = new Subject<MarketTick>();
  public readonly marketTicks$ = this.marketTickSubject.asObservable();
  private readonly tradeEventsSubject = new Subject<TradeEvent>();
  public readonly tradeEvents$ = this.tradeEventsSubject.asObservable();

  constructor(private readonly cacheService: CacheService) {
    super(CLOB_MARKET_WS_URL);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down Market WebSocket...');
    this.marketTickSubject.complete();
    this.tradeEventsSubject.complete();
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
          case 'last_trade_price':
            this.processLastTradePrice(message);
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

    const parsedBids = message.bids.map(parseOrderSummary);
    const parsedAsks = message.asks.map(parseOrderSummary);

    const bestBid = parsedBids.length > 0 ? parsedBids.sort((a, b) => b[0] - a[0])[0][0] : 0;
    const totalBidVolume = parsedBids.reduce((sum, [, size]) => sum + size, 0);
    const totalAskVolume = parsedAsks.reduce((sum, [, size]) => sum + size, 0);

    const state = this.getMarketState(message.market);
    state[message.asset_id] = { bestBid, totalBidVolume, totalAskVolume };
    const assetIds = Object.keys(state);

    if (assetIds.length === 2) {
      const yesState = state[market.yesToken];
      const noState = state[market.noToken];
      this.marketTickSubject.next({
        conditionId: message.market,
        yesAssetId: market.yesToken,
        noAssetId: market.noToken,
        bestBidYes: yesState.bestBid,
        bestBidNo: noState.bestBid,
        timestamp: parseInt(message.timestamp),
        timeRemaining: market.endDate.getTime() - Date.now(),
        minTickSize: market.orderPriceMinTickSize,
        yesBidVolume: yesState.totalBidVolume,
        yesAskVolume: yesState.totalAskVolume,
        noBidVolume: noState.totalBidVolume,
        noAskVolume: noState.totalAskVolume,
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

  private processLastTradePrice(message: LastTradePriceMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      return;
    }

    this.tradeEventsSubject.next({
      conditionId: message.market,
      assetId: message.asset_id,
      side: message.side,
      price: parseFloat(message.price),
      size: parseFloat(message.size),
      timestamp: parseInt(message.timestamp),
    });
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
