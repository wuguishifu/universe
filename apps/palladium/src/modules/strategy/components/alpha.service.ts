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
    const env = this.environmentService.environment;

    const filters: { name: string; fn: () => boolean }[] = [
      {
        name: 'time-remaining',
        fn: () => tick.timeRemaining >= env.minTimeRemainingMs && tick.timeRemaining <= env.maxTimeRemainingMs,
      },
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

    const binancePrice = snapshot.currentPrice;

    // 4. Parse strike + direction from question
    const parsed = this.parseStrikeAndDirection(market.question);
    if (!parsed) {
      this.osmiumService.trackDebug({
        name: 'alpha-strike-parse-failed',
        metadata: { conditionId: tick.conditionId, question: market.question },
      });
      return null;
    }

    const { strikePrice, direction } = parsed;

    // 5. Compute distance percent
    const distancePercent = Math.abs(binancePrice - strikePrice) / strikePrice;

    // 6. Determine side
    let side: 'YES' | 'NO';
    if (direction === 'above') {
      side = binancePrice > strikePrice ? 'YES' : 'NO';
    } else {
      side = binancePrice < strikePrice ? 'YES' : 'NO';
    }

    // Track evaluated tick (every tick that passes throttling and has valid Binance/strike data)
    this.osmiumService.trackDebug({
      name: 'alpha-tick-evaluated',
      metadata: {
        conditionId: tick.conditionId,
        asset: market.asset,
        binancePrice,
        strikePrice,
        distancePercent,
        side,
        bestAskYes: tick.bestAskYes,
        bestAskNo: tick.bestAskNo,
        timeRemaining: tick.timeRemaining,
      },
    });

    // 7. Distance check
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

    // 8. Get ask for the favorable side
    const ask = side === 'YES' ? tick.bestAskYes : tick.bestAskNo;

    // 9. Skip if no liquidity or already repriced
    if (ask <= 0 || ask >= env.maxEntryPrice) {
      this.osmiumService.trackDebug({
        name: 'alpha-filter-reject',
        metadata: {
          filter: 'ask-check',
          conditionId: tick.conditionId,
          side,
          ask,
          maxEntryPrice: env.maxEntryPrice,
        },
      });
      return null;
    }

    const plan: EntryPlan = {
      conditionId: tick.conditionId,
      quantity: env.targetPositionSize,
      side,
      price: ask,
      reason: `latency-arb: binance=${binancePrice}, strike=${strikePrice}, distance=${(distancePercent * 100).toFixed(2)}%`,
    };

    this.osmiumService.trackEvent({
      name: 'alpha-entry-plan-generated',
      metadata: {
        ...plan,
        binancePrice,
        strikePrice,
        distancePercent,
        timeRemaining: tick.timeRemaining,
      },
    });

    this.logger.debug(`Generated entry plan for ${tick.conditionId}: ${JSON.stringify(plan)}`);
    return plan;
  }

  private parseStrikeAndDirection(question: string): { strikePrice: number; direction: 'above' | 'below' } | null {
    const match = /\$([0-9,]+(?:\.[0-9]+)?)/.exec(question);
    if (!match) {
      return null;
    }
    const strikePrice = parseFloat(match[1].replace(/,/g, ''));
    const isAbove = /above/i.test(question);
    const isBelow = /below/i.test(question);
    if (!isAbove && !isBelow) {
      return null;
    }
    return { strikePrice, direction: isAbove ? 'above' : 'below' };
  }
  // #endregion
}
