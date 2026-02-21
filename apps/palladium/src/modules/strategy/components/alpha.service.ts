import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';

import { OsmiumService } from '@wuguishifu/nest-common';
import { getOrCreateList } from '@wuguishifu/utils-polymarket';

import { EnvironmentService } from '../../../environment/environment-service';
import { BinancePriceService } from '../../binance/binance-price.service';
import { MarketTick } from '../../clob-ws/market-ws.service';

type PriceHistoryEntry = {
  yesPrice: number;
  noPrice: number;
  timestamp: number;
};

type TradeHistoryEntry = {
  assetId: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
};

type ConditionId = string;

export type EntryPlan = {
  conditionId: ConditionId;
  quantity: number;
  side: 'YES' | 'NO';
  reason: string;
};

@Injectable()
export class AlphaService implements OnModuleDestroy {
  private readonly logger = new Logger(AlphaService.name);

  private readonly priceHistory = new Map<ConditionId, PriceHistoryEntry[]>();
  private readonly tradeHistory = new Map<ConditionId, TradeHistoryEntry[]>();
  private readonly lastEvaluationTimestamp = new Map<ConditionId, number>();

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly binancePriceService: BinancePriceService,
  ) {}

  onModuleDestroy() {
    this.logger.debug('Shutting down alpha service...');
    this.lastEvaluationTimestamp.clear();
    this.priceHistory.clear();
    this.tradeHistory.clear();
  }

  public analyzeTick(tick: MarketTick): EntryPlan | null {
    this.recordPriceHistory(tick);

    if (this.environmentService.environment.enableVerboseEvents) {
      const btcSnapshot = this.binancePriceService.getSnapshot();
      this.osmiumService.trackDebug({
        name: 'btc-correlation',
        metadata: {
          conditionId: tick.conditionId,
          polyBestBidYes: tick.bestBidYes,
          polyBestBidNo: tick.bestBidNo,
          btcPrice: btcSnapshot.currentPrice,
          btcVelocity: btcSnapshot.velocityPerSecond,
          btcAcceleration: btcSnapshot.accelerationPerSecond2,
          msSinceLastBtcTick: btcSnapshot.msSinceLastTick,
        },
      });
    }

    const filters: { name: string; fn: () => boolean }[] = [
      { name: 'throttling', fn: () => this.filterForThrottling(tick) },
    ];

    for (const { name, fn } of filters) {
      if (!fn()) {
        if (this.environmentService.environment.enableVerboseEvents) {
          this.osmiumService.trackDebug({
            name: `filter-reject`,
            metadata: {
              conditionId: tick.conditionId,
              filter: name,
              bestBidYes: tick.bestBidYes,
              bestBidNo: tick.bestBidNo,
              timeRemaining: tick.timeRemaining,
            },
          });
        }
        return null;
      }
    }

    this.recordEvaluation(tick.conditionId);

    const plan = this.calculateEntryPlan(tick);
    if (plan) {
      this.logger.debug(`Generated entry plan for ${tick.conditionId}: ${JSON.stringify(plan)}`);
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'filter-pass-all',
          metadata: {
            ...plan,
            ...tick,
            yesSpread: tick.bestAskYes - tick.bestBidYes,
            noSpread: tick.bestAskNo - tick.bestBidNo,
          },
        });
      }
    }
    return plan;
  }

  // #region tapping
  private recordPriceHistory(tick: MarketTick) {
    if (tick.bestBidYes <= 0.01 || tick.bestBidNo <= 0.01 || tick.bestBidYes >= 0.99 || tick.bestBidNo >= 0.99) {
      return;
    }

    const history = getOrCreateList(this.priceHistory, tick.conditionId);
    history.push({
      yesPrice: tick.bestBidYes,
      noPrice: tick.bestBidNo,
      timestamp: tick.timestamp,
    });

    const cutoffTime = tick.timestamp - this.environmentService.environment.maxHistoryRetentionMs;
    this.pruneOldEntries(history, cutoffTime);
  }

  private recordEvaluation(conditionId: ConditionId) {
    this.lastEvaluationTimestamp.set(conditionId, Date.now());
  }
  // #endregion

  // #region filters
  private filterForThrottling(tick: MarketTick): boolean {
    const now = Date.now();
    const lastTime = this.lastEvaluationTimestamp.get(tick.conditionId) ?? 0;
    return now - lastTime >= 100;
  }
  // #endregion

  // #region util
  private pruneOldEntries(entries: { timestamp: number }[], cutoffTime: number) {
    const idx = entries.findIndex((h) => h.timestamp >= cutoffTime);
    if (idx === -1) {
      if (entries.length > 0) {
        entries.length = 0;
      }
    } else if (idx > 0) {
      entries.splice(0, idx);
    }
  }

  public deleteCondition(conditionId: ConditionId) {
    this.priceHistory.delete(conditionId);
    this.tradeHistory.delete(conditionId);
    this.lastEvaluationTimestamp.delete(conditionId);
  }
  // #endregion

  // #region entry calculation
  private calculateEntryPlan(tick: MarketTick): EntryPlan | null {
    // placehodler example
    const roundedValue = this.roundDown(10, tick.minTickSize);
    console.log('example on how to use roundDown', { roundedValue });

    return null;
  }

  private roundDown(value: number, tickSize: TickSize): number {
    const factor = 1 / parseFloat(tickSize);
    return Math.floor(value * factor) / factor;
  }
  // #endregion
}
