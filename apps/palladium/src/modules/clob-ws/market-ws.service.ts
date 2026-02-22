import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { OsmiumService, WebSocketService } from '@wuguishifu/nest-common';
import {
  BookMessage,
  CLOB_MARKET_WS_URL,
  isExpired,
  Market,
  Message,
  PriceChangeMessage,
  TickSizeChangeMessage,
} from '@wuguishifu/utils-polymarket';

import { EnvironmentService } from '../../environment/environment-service';
import { CacheService } from '../cache/cache.service';

export type MarketTick = {
  conditionId: string;
  yesAssetId: string;
  noAssetId: string;
  bestBidYes: number;
  bestBidNo: number;
  bestAskYes: number;
  bestAskNo: number;
  timestamp: number;
  timeRemaining: number;
  minTickSize: TickSize;
  yesBidVolume?: number;
  yesAskVolume?: number;
  noBidVolume?: number;
  noAskVolume?: number;
  yesNearAskDepth: number;
  noNearAskDepth: number;
};

type OrderBookSide = Map<string, number>; // price string → size

type AssetOrderBook = {
  bids: OrderBookSide;
  asks: OrderBookSide;
  bestBid: number;
  bestAsk: number;
  totalBidVolume: number;
  totalAskVolume: number;
  nearAskDepth: number;
};

type MarketState = { [assetId: string]: AssetOrderBook };

@Injectable()
export class MarketWsService extends WebSocketService implements OnModuleDestroy {
  protected readonly logger = new Logger(MarketWsService.name);

  private marketState = new Map<string, MarketState>();
  private subscribedTokenIds = new Set<string>();
  private readonly marketTickSubject = new Subject<MarketTick>();
  public readonly marketTicks$ = this.marketTickSubject.asObservable();

  constructor(
    private readonly cacheService: CacheService,
    private readonly osmiumService: OsmiumService,
    private readonly environmentService: EnvironmentService,
  ) {
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
      this.send({ operation: 'subscribe', channel: 'market', assets_ids: Array.from(this.subscribedTokenIds) });
    }
  }

  protected onError(error: Error): void {
    this.osmiumService.trackDebug({ name: 'clob_ws-error', metadata: { message: error.message, type: 'market' } });
  }

  protected onClose(code: number, reason: string): void {
    this.osmiumService.trackDebug({ name: 'clob_ws-closed', metadata: { code, reason, type: 'market' } });
  }

  protected handleMessage(data: WebSocket.Data) {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach((message) => {
        switch (message.event_type) {
          case 'book':
            this.processBookSnapshot(message);
            break;
          case 'price_change':
            this.processPriceChange(message);
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

  private processBookSnapshot(message: BookMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      this.logger.debug(`Received book update for unknown market: ${message.market}`);
      return;
    }

    const state = this.getMarketState(message.market);
    const book = this.getOrInitBook(state, message.asset_id);

    // full snapshot — clear and replace
    book.bids.clear();
    book.asks.clear();

    for (const level of message.bids) {
      const size = parseFloat(level.size);
      if (size > 0) {
        book.bids.set(level.price, size);
      }
    }
    for (const level of message.asks) {
      const size = parseFloat(level.size);
      if (size > 0) {
        book.asks.set(level.price, size);
      }
    }

    this.recomputeAggregates(book);
    this.emitMarketTick(message.market, market, state, 'book');
  }

  private processPriceChange(message: PriceChangeMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      return;
    }

    const state = this.getMarketState(message.market);

    for (const change of message.price_changes) {
      const book = this.getOrInitBook(state, change.asset_id);
      const sideMap = change.side === 'BUY' ? book.bids : book.asks;
      const newSize = parseFloat(change.size);

      if (newSize === 0) {
        sideMap.delete(change.price);
      } else {
        sideMap.set(change.price, newSize);
      }

      this.recomputeAggregates(book);
    }

    this.emitMarketTick(message.market, market, state, 'price_change');
  }

  private recomputeAggregates(book: AssetOrderBook) {
    let bestBid = 0;
    let totalBidVolume = 0;
    book.bids.forEach((size, priceStr) => {
      totalBidVolume += size;
      const price = parseFloat(priceStr);
      if (price > bestBid) {
        bestBid = price;
      }
    });

    let bestAsk = Infinity;
    let totalAskVolume = 0;
    book.asks.forEach((size, priceStr) => {
      totalAskVolume += size;
      const price = parseFloat(priceStr);
      if (price < bestAsk) {
        bestAsk = price;
      }
    });

    const resolvedBestAsk = bestAsk === Infinity ? 0 : bestAsk;

    let nearAskDepth = 0;
    const depthRange = 0.05;
    book.asks.forEach((size, priceStr) => {
      const price = parseFloat(priceStr);
      if (price <= resolvedBestAsk + depthRange) {
        nearAskDepth += size;
      }
    });

    book.bestBid = bestBid;
    book.bestAsk = resolvedBestAsk;
    book.totalBidVolume = totalBidVolume;
    book.totalAskVolume = totalAskVolume;
    book.nearAskDepth = nearAskDepth;
  }

  private emitMarketTick(conditionId: string, market: Market, state: MarketState, source: 'book' | 'price_change') {
    if (isExpired(market)) {
      return;
    }

    const yesBook = state[market.yesToken];
    const noBook = state[market.noToken];
    if (!yesBook || !noBook) {
      return;
    }

    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'book-update',
        metadata: {
          conditionId,
          source,
          bestBidYes: yesBook.bestBid,
          bestBidNo: noBook.bestBid,
          bestAskYes: yesBook.bestAsk,
          bestAskNo: noBook.bestAsk,
          yesBidVolume: yesBook.totalBidVolume,
          yesAskVolume: yesBook.totalAskVolume,
          noBidVolume: noBook.totalBidVolume,
          noAskVolume: noBook.totalAskVolume,
          yesBidLevels: yesBook.bids.size,
          yesAskLevels: yesBook.asks.size,
          noBidLevels: noBook.bids.size,
          noAskLevels: noBook.asks.size,
        },
      });
    }

    this.marketTickSubject.next({
      conditionId,
      yesAssetId: market.yesToken,
      noAssetId: market.noToken,
      bestBidYes: yesBook.bestBid,
      bestBidNo: noBook.bestBid,
      bestAskYes: yesBook.bestAsk,
      bestAskNo: noBook.bestAsk,
      timestamp: Date.now(),
      timeRemaining: market.endDate.getTime() - Date.now(),
      minTickSize: market.orderPriceMinTickSize,
      yesBidVolume: yesBook.totalBidVolume,
      yesAskVolume: yesBook.totalAskVolume,
      noBidVolume: noBook.totalBidVolume,
      noAskVolume: noBook.totalAskVolume,
      yesNearAskDepth: yesBook.nearAskDepth,
      noNearAskDepth: noBook.nearAskDepth,
    });
  }

  private getOrInitBook(state: MarketState, assetId: string): AssetOrderBook {
    if (!state[assetId]) {
      state[assetId] = {
        bids: new Map(),
        asks: new Map(),
        bestBid: 0,
        bestAsk: 0,
        totalBidVolume: 0,
        totalAskVolume: 0,
        nearAskDepth: 0,
      };
    }
    return state[assetId];
  }

  private processTickSizeChange(message: TickSizeChangeMessage) {
    const market = this.cacheService.markets.get(message.market);
    if (!market) {
      this.logger.debug(`Received tick size change for unknown market: ${message.market}`);
      return;
    }

    market.orderPriceMinTickSize = message.new_tick_size;
  }

  public syncSubscriptions(activeMarkets: Market[]) {
    const desiredTokenIds = new Set(activeMarkets.flatMap((market) => [market.noToken, market.yesToken]));
    const desiredConditionIds = new Set(activeMarkets.map((market) => market.conditionId));

    const staleTokenIds = Array.from(this.subscribedTokenIds).filter((id) => !desiredTokenIds.has(id));
    if (staleTokenIds.length > 0) {
      this.logger.debug(`Unsubscribing from ${staleTokenIds.length} stale tokens`);
      staleTokenIds.forEach((id) => this.subscribedTokenIds.delete(id));
      this.send({ operation: 'unsubscribe', channel: 'market', assets_ids: staleTokenIds });
    }

    const newTokenIds = Array.from(desiredTokenIds).filter((id) => !this.subscribedTokenIds.has(id));
    if (newTokenIds.length > 0) {
      this.logger.debug(`Subscribing to ${newTokenIds.length} new tokens (${activeMarkets.length} markets)`);
      newTokenIds.forEach((id) => this.subscribedTokenIds.add(id));
      this.send({ operation: 'subscribe', channel: 'market', assets_ids: newTokenIds });
    }

    for (const conditionId of this.marketState.keys()) {
      if (!desiredConditionIds.has(conditionId)) {
        this.marketState.delete(conditionId);
      }
    }

    activeMarkets.forEach((market) => this.getMarketState(market.conditionId));
  }

  public getBestBid(conditionId: string, side: 'yes' | 'no'): number | undefined {
    const market = this.cacheService.markets.get(conditionId);
    if (!market) {
      return undefined;
    }
    const state = this.marketState.get(conditionId);
    if (!state) {
      return undefined;
    }
    const tokenId = side === 'yes' ? market.yesToken : market.noToken;
    const book = state[tokenId];
    return book?.bestBid ?? undefined;
  }

  private getMarketState(conditionId: string): MarketState {
    return (
      this.marketState.get(conditionId) ??
      (() => {
        const state: MarketState = {};
        this.marketState.set(conditionId, state);
        return state;
      })()
    );
  }
}
