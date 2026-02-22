import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../../environment/environment-service';
import { BinancePriceService } from '../../binance/binance-price.service';
import { CacheService } from '../../cache/cache.service';
import { MarketTick } from '../../clob-ws/market-ws.service';

type ConditionId = string;

export type EntryPlan = {
  conditionId: ConditionId;
  quantity: number;
  side: 'YES' | 'NO';
  price: number;
  reason: string;
};

const ASSET_TO_BINANCE_SYMBOL: Record<string, string> = {
  btc: 'BTC',
  eth: 'ETH',
  sol: 'SOL',
  xrp: 'XRP',
};

const BINANCE_STALE_MS = 5_000;

@Injectable()
export class AlphaService implements OnModuleDestroy {
  private readonly logger = new Logger(AlphaService.name);

  private readonly lastEvaluationTimestamp = new Map<ConditionId, number>();

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly binancePriceService: BinancePriceService,
    private readonly cacheService: CacheService,
  ) {}

  onModuleDestroy() {
    this.logger.debug('Shutting down alpha service...');
    this.lastEvaluationTimestamp.clear();
  }

  public analyzeTick(tick: MarketTick): EntryPlan | null {
    const filters: { name: string; fn: () => boolean }[] = [
      { name: 'time-remaining', fn: () => this.filterForTimeRemaining(tick) },
      { name: 'throttling', fn: () => this.filterForThrottling(tick) },
    ];

    for (const { name, fn } of filters) {
      if (!fn()) {
        this.osmiumService.trackDebug({
          name: 'alpha-filter-reject',
          metadata: {
            filter: name,
            conditionId: tick.conditionId,
            bestAskYes: tick.bestAskYes,
            bestAskNo: tick.bestAskNo,
            timeRemaining: tick.timeRemaining,
          },
        });
        return null;
      }
    }

    this.lastEvaluationTimestamp.set(tick.conditionId, Date.now());

    return this.calculateEntryPlan(tick);
  }

  // #region filters
  private filterForTimeRemaining(tick: MarketTick): boolean {
    const environment = this.environmentService.environment;
    return tick.timeRemaining >= environment.minTimeRemainingMs && tick.timeRemaining <= environment.maxTimeRemainingMs;
  }

  private filterForThrottling(tick: MarketTick): boolean {
    const now = Date.now();
    const lastTime = this.lastEvaluationTimestamp.get(tick.conditionId) ?? 0;
    return now - lastTime >= 100;
  }
  // #endregion

  // #region entry calculation
  private calculateEntryPlan(tick: MarketTick): EntryPlan | null {
    const env = this.environmentService.environment;

    // 1. Lookup market in cache
    const market = this.cacheService.markets.get(tick.conditionId);
    if (!market) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: { filter: 'market-not-found', conditionId: tick.conditionId },
      });
      return null;
    }

    // 2. Map asset to Binance symbol
    const symbol = ASSET_TO_BINANCE_SYMBOL[market.asset.toLowerCase()];
    if (!symbol) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: { filter: 'asset-not-recognized', conditionId: tick.conditionId, asset: market.asset },
      });
      return null;
    }

    // 3. Get Binance snapshot; skip if null or stale
    const snapshot = this.binancePriceService.getSnapshot(symbol);
    if (!snapshot.currentPrice || snapshot.msSinceLastTick === null || snapshot.msSinceLastTick > BINANCE_STALE_MS) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: {
          filter: 'binance-stale',
          conditionId: tick.conditionId,
          symbol,
          msSinceLastTick: snapshot.msSinceLastTick,
        },
      });
      return null;
    }

    const currentPrice = snapshot.currentPrice;

    // 4. Get the open price of the current 5m candle.
    //    The candle openTime should align with the market's eventStartTime.
    const candle = this.binancePriceService.getCandleOpen(symbol);
    if (!candle) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: { filter: 'no-candle-data', conditionId: tick.conditionId, symbol },
      });
      return null;
    }

    // Verify the candle aligns with this market's window (within 60s tolerance)
    const windowStartTs = market.eventStartTime.getTime();
    if (Math.abs(candle.openTime - windowStartTs) > 60_000) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: {
          filter: 'candle-mismatch',
          conditionId: tick.conditionId,
          symbol,
          candleOpenTime: candle.openTime,
          windowStartTs,
          diffMs: candle.openTime - windowStartTs,
        },
      });
      return null;
    }

    const startPrice = candle.openPrice;

    // 5. Compute how far the price has moved since the window opened
    const distancePercent = Math.abs(currentPrice - startPrice) / startPrice;

    // 6. Determine direction: YES = "Up" (price rose), NO = "Down" (price fell)
    const isUp = currentPrice >= startPrice;
    const side: 'YES' | 'NO' = isUp ? 'YES' : 'NO';

    // Track evaluated tick
    this.osmiumService.trackDebug({
      name: 'alpha-tick-evaluated',
      metadata: {
        conditionId: tick.conditionId,
        asset: market.asset,
        currentPrice,
        startPrice,
        distancePercent,
        direction: isUp ? 'up' : 'down',
        side,
        bestAskYes: tick.bestAskYes,
        bestAskNo: tick.bestAskNo,
        timeRemaining: tick.timeRemaining,
      },
    });

    // 7. Distance check — require a clear directional signal
    if (distancePercent < env.minPriceDistancePercent) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: {
          filter: 'distance-too-small',
          conditionId: tick.conditionId,
          distancePercent,
          minPriceDistancePercent: env.minPriceDistancePercent,
        },
      });
      return null;
    }

    // 8. Get ask for the winning side
    const ask = side === 'YES' ? tick.bestAskYes : tick.bestAskNo;

    // 9. Limit bid one tick below the best ask: top of book, qualifies for maker rebate
    const tickSize = parseFloat(tick.minTickSize);
    const limitPrice = Math.round((ask - tickSize) * 1e8) / 1e8;

    if (ask <= 0 || limitPrice <= 0) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: { filter: 'no-liquidity', conditionId: tick.conditionId, side, ask },
      });
      return null;
    }

    const plan: EntryPlan = {
      conditionId: tick.conditionId,
      quantity: env.targetPositionSize,
      side,
      price: limitPrice,
      reason: `expiry-maker: current=${currentPrice}, start=${startPrice}, distance=${(distancePercent * 100).toFixed(3)}%, direction=${isUp ? 'up' : 'down'}, ask=${ask}, bid=${limitPrice}`,
    };

    this.osmiumService.trackEvent({
      name: 'alpha-entry-plan-generated',
      metadata: {
        ...plan,
        currentPrice,
        startPrice,
        distancePercent,
        ask,
        tickSize,
        timeRemaining: tick.timeRemaining,
      },
    });

    this.logger.debug(`Generated entry plan for ${tick.conditionId}: ${JSON.stringify(plan)}`);
    return plan;
  }
  // #endregion
}
