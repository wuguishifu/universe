import { Injectable, Logger } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { share, Subject } from 'rxjs';
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
export class MarketWsService extends WebSocketService {
  protected readonly logger = new Logger(MarketWsService.name);

  private marketState = new Map<string, MarketState>();
  private readonly marketTickSubject = new Subject<MarketTick>();
  public readonly marketTicks$ = this.marketTickSubject.asObservable().pipe(share());

  constructor(private readonly cacheService: CacheService) {
    super(CLOB_MARKET_WS_URL);
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
        timeElapsed: Date.now() - market.startDate.getTime(),
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
