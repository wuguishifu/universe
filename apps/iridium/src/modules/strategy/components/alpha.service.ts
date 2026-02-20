import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../../environment/environment-service';
import { getOrCreateList } from '../../../utils/map.utils';
import { BinancePriceService } from '../../binance/binance-price.service';
import { MarketTick, TradeEvent } from '../../clob/ws/market-ws.service';
import { MarketAdapterService } from '../../market-adapter/market-adapter.service';

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
  targetYes: number;
  targetNo: number;
  quantity: number;
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
    private readonly marketAdapterService: MarketAdapterService,
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
      { name: 'trading_hours', fn: () => this.filterForTradingHours() },
      { name: 'book_depth', fn: () => this.filterForBookDepth(tick) },
      { name: 'time_remaining', fn: () => this.filterForTimeRemaining(tick) },
      { name: 'skew', fn: () => this.filterForSkew(tick) },
      { name: 'stability', fn: () => this.filterForStability(tick) },
      { name: 'linear_regression', fn: () => this.filterForLinearRegression(tick) },
      { name: 'obi', fn: () => this.filterForObi(tick) },
      { name: 'toxic_flow', fn: () => this.filterForToxicFlow(tick) },
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
            totalEntryCost: plan.targetYes + plan.targetNo,
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
  private filterForTradingHours(): boolean {
    const startHour =
      this.environmentService.environment.tradingStartHourUtcOverride ??
      this.marketAdapterService.adapter.tradingStartHourUtc;
    const endHour =
      this.environmentService.environment.tradingEndHourUtcOverride ??
      this.marketAdapterService.adapter.tradingEndHourUtc;
    const excludeStart =
      this.environmentService.environment.tradingExcludeHoursUtcStart ??
      this.marketAdapterService.adapter.tradingExcludeHoursUtcStart;
    const excludeEnd =
      this.environmentService.environment.tradingExcludeHoursUtcEnd ??
      this.marketAdapterService.adapter.tradingExcludeHoursUtcEnd;

    if (startHour == null && endHour == null && excludeStart == null) {
      return true;
    }

    const currentHour = new Date().getUTCHours();

    if (startHour != null && endHour != null) {
      if (startHour <= endHour) {
        if (!(currentHour >= startHour && currentHour < endHour)) {
          return false;
        }
      } else {
        // Wrap-around (e.g., start=22, end=6 means 22:00-06:00 UTC)
        if (!(currentHour >= startHour || currentHour < endHour)) {
          return false;
        }
      }
    } else if (startHour != null) {
      if (currentHour < startHour) {
        return false;
      }
    } else if (endHour != null) {
      if (currentHour >= endHour) {
        return false;
      }
    }

    // Exclusion window: block a specific range within the trading day
    if (excludeStart != null && excludeEnd != null) {
      const inExclusionWindow =
        excludeStart <= excludeEnd
          ? currentHour >= excludeStart && currentHour < excludeEnd
          : currentHour >= excludeStart || currentHour < excludeEnd;
      if (inExclusionWindow) {
        return false;
      }
    }

    return true;
  }

  private filterForBookDepth(tick: MarketTick): boolean {
    const { enableBookDepthFilter, minBookDepth } = this.environmentService.environment;

    if (!enableBookDepthFilter) {
      return true;
    }

    const passed = tick.yesNearAskDepth >= minBookDepth && tick.noNearAskDepth >= minBookDepth;

    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'book-depth-eval',
        metadata: {
          conditionId: tick.conditionId,
          yesNearAskDepth: tick.yesNearAskDepth,
          noNearAskDepth: tick.noNearAskDepth,
          minBookDepth,
          passed,
        },
      });
    }

    if (!passed) {
      const rejectSide = tick.yesNearAskDepth < minBookDepth ? 'YES' : 'NO';
      const rejectValue = rejectSide === 'YES' ? tick.yesNearAskDepth : tick.noNearAskDepth;
      this.logger.debug(
        `Book depth reject ${tick.conditionId}: ${rejectSide} near-ask depth ${rejectValue.toFixed(1)} < ${minBookDepth}`,
      );
      return false;
    }

    return true;
  }

  private filterForTimeRemaining(tick: MarketTick): boolean {
    const maxTimeRemainingMs =
      this.environmentService.environment.maxTimeRemainingMsOverride ??
      this.marketAdapterService.adapter.maxTimeRemainingMs;
    if (tick.timeRemaining > maxTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too much)`);
      return false;
    }

    const minTimeRemainingMs =
      this.environmentService.environment.minTimeRemainingMsOverride ??
      this.marketAdapterService.adapter.minTimeRemainingMs;
    if (tick.timeRemaining <= minTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too little)`);
      return false;
    }

    return true;
  }

  private filterForSkew(tick: MarketTick): boolean {
    if (!this.environmentService.environment.enableSkewCheck) {
      return true;
    }

    const { minSkewPriceCutoff, minTotalCost, maxTotalCost } = this.environmentService.environment;
    if (tick.bestBidNo <= minSkewPriceCutoff || tick.bestBidYes <= minSkewPriceCutoff) {
      this.logger.debug(
        `Skipping market ${tick.conditionId} with bids Yes:${tick.bestBidYes.toFixed(4)} No:${tick.bestBidNo.toFixed(4)} (too skewed)`,
      );
      return false;
    }

    const totalCost = tick.bestBidYes + tick.bestBidNo;
    if (totalCost <= minTotalCost) {
      this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too low)`);
      return false;
    }

    if (totalCost >= maxTotalCost) {
      this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too high)`);
      return false;
    }

    return true;
  }

  private filterForThrottling(tick: MarketTick): boolean {
    const now = Date.now();
    const lastTime = this.lastEvaluationTimestamp.get(tick.conditionId) ?? 0;
    return now - lastTime >= 100;
  }

  private filterForStability(tick: MarketTick): boolean {
    const { priceStabilityRangeCents, priceStabilityDurationMs, enablePriceStabilityCheck } =
      this.environmentService.environment;

    if (!enablePriceStabilityCheck) {
      return true;
    }
    if (!priceStabilityRangeCents || !priceStabilityDurationMs) {
      return true;
    }

    const history = getOrCreateList(this.priceHistory, tick.conditionId);

    // 1. Cold Start Check
    // If we have no history, or the history is too short to cover the required duration
    if (!history || history.length < 2) {
      // Optional: Log debug "Cold start"
      return false;
    }

    // 2. Coverage Check
    // We need to ensure our history spans at least 'priceStabilityDurationMs'
    const oldestAllowedTimestamp = tick.timestamp - priceStabilityDurationMs;
    const oldestDataPoint = history[0].timestamp;

    if (oldestDataPoint > oldestAllowedTimestamp) {
      // Our history only goes back 1 second, but we need 2 seconds to prove stability.
      // We are not ready yet.
      return false;
    }

    // 3. Stability Calculation
    const rangeDollars = priceStabilityRangeCents / 100;

    // We iterate backwards (newest to oldest) as an optimization,
    // but forward works too. We only check points within the duration window.
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];

      // Stop checking if we go past the duration window
      if (entry.timestamp < oldestAllowedTimestamp) {
        break;
      }

      const yesDelta = Math.abs(entry.yesPrice - tick.bestBidYes);
      const noDelta = Math.abs(entry.noPrice - tick.bestBidNo);

      if (yesDelta > rangeDollars || noDelta > rangeDollars) {
        this.logger.debug(
          `Unstable ${tick.conditionId}: Deviation > ${rangeDollars} within last ${priceStabilityDurationMs}ms`,
        );
        return false;
      }
    }

    return true;
  }

  private filterForLinearRegression(tick: MarketTick): boolean {
    const { enableLinearRegressionFilter, maxPriceSlopePerSec, minRegressionDataPoints } =
      this.environmentService.environment;

    if (!enableLinearRegressionFilter) {
      return true;
    }

    const history = this.priceHistory.get(tick.conditionId);
    if (!history || history.length < minRegressionDataPoints) {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'linreg-cold-start',
          metadata: {
            conditionId: tick.conditionId,
            dataPoints: history?.length ?? 0,
            required: minRegressionDataPoints,
          },
        });
      }
      return false;
    }

    const yesPoints = history.map((h) => ({ t: h.timestamp, v: h.yesPrice }));
    const noPoints = history.map((h) => ({ t: h.timestamp, v: h.noPrice }));

    const yesSlope = this.computeLinearRegressionSlope(yesPoints);
    const noSlope = this.computeLinearRegressionSlope(noPoints);

    // slope is per-millisecond, convert to per-second
    const yesSlopePerSec = Math.abs(yesSlope * 1000);
    const noSlopePerSec = Math.abs(noSlope * 1000);

    const passed = yesSlopePerSec <= maxPriceSlopePerSec && noSlopePerSec <= maxPriceSlopePerSec;

    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'linreg-eval',
        metadata: {
          conditionId: tick.conditionId,
          yesSlopePerSec,
          noSlopePerSec,
          maxPriceSlopePerSec,
          dataPoints: history.length,
          passed,
        },
      });
    }

    if (!passed) {
      this.logger.debug(
        `Steep slope ${tick.conditionId}: YES=${yesSlopePerSec.toFixed(4)}/s NO=${noSlopePerSec.toFixed(4)}/s (max ${maxPriceSlopePerSec})`,
      );
      return false;
    }

    return true;
  }

  private computeLinearRegressionSlope(points: { t: number; v: number }[]): number {
    const n = points.length;
    if (n < 2) {
      return 0;
    }

    // normalize timestamps to avoid float precision issues with large epoch values
    const t0 = points[0].t;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (const p of points) {
      const x = p.t - t0;
      sumX += x;
      sumY += p.v;
      sumXY += x * p.v;
      sumX2 += x * x;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) {
      return 0;
    }

    return (n * sumXY - sumX * sumY) / denom;
  }

  private filterForObi(tick: MarketTick): boolean {
    const { enableObiFilter, minObiBidAskRatio } = this.environmentService.environment;

    if (!enableObiFilter) {
      return true;
    }

    // guard against undefined volume fields for backward compat
    if (
      tick.yesBidVolume === undefined ||
      tick.yesAskVolume === undefined ||
      tick.noBidVolume === undefined ||
      tick.noAskVolume === undefined
    ) {
      return true;
    }

    const yesRatio = tick.yesAskVolume > 0 ? tick.yesBidVolume / tick.yesAskVolume : Infinity;
    const noRatio = tick.noAskVolume > 0 ? tick.noBidVolume / tick.noAskVolume : Infinity;
    const passed = yesRatio >= minObiBidAskRatio && noRatio >= minObiBidAskRatio;

    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'obi-eval',
        metadata: {
          conditionId: tick.conditionId,
          yesBidVolume: tick.yesBidVolume,
          yesAskVolume: tick.yesAskVolume,
          noBidVolume: tick.noBidVolume,
          noAskVolume: tick.noAskVolume,
          yesRatio: yesRatio === Infinity ? null : yesRatio,
          noRatio: noRatio === Infinity ? null : noRatio,
          minObiBidAskRatio,
          passed,
        },
      });
    }

    if (!passed) {
      const rejectSide = yesRatio < minObiBidAskRatio ? 'YES' : 'NO';
      const rejectRatio = rejectSide === 'YES' ? yesRatio : noRatio;
      this.logger.debug(
        `OBI reject ${tick.conditionId}: ${rejectSide} bid/ask ratio ${rejectRatio.toFixed(3)} < ${minObiBidAskRatio}`,
      );
      return false;
    }

    return true;
  }

  private filterForToxicFlow(tick: MarketTick): boolean {
    const { enableToxicFlowFilter, toxicFlowWindowMs, toxicFlowMinTrades, toxicFlowSellRatioThreshold } =
      this.environmentService.environment;

    if (!enableToxicFlowFilter) {
      return true;
    }

    // do not want to create an empty list here if it does not exist
    const history = this.tradeHistory.get(tick.conditionId);
    if (!history || history.length === 0) {
      return true; // optimistic cold start
    }

    const now = Date.now();
    const cutoff = now - toxicFlowWindowMs;

    // check each side (yes and no asset)
    for (const assetId of [tick.yesAssetId, tick.noAssetId]) {
      const recentTrades = history.filter((t) => t.assetId === assetId && t.timestamp >= cutoff);
      if (recentTrades.length < toxicFlowMinTrades) {
        continue;
      }

      const sellCount = recentTrades.filter((t) => t.side === 'SELL').length;
      const buyCount = recentTrades.length - sellCount;
      const sellRatio = sellCount / recentTrades.length;

      const side = assetId === tick.yesAssetId ? 'YES' : 'NO';

      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'toxic-flow-eval',
          metadata: {
            conditionId: tick.conditionId,
            side,
            assetId,
            recentTradeCount: recentTrades.length,
            sellCount,
            buyCount,
            sellRatio,
            toxicFlowSellRatioThreshold,
            toxic: sellRatio >= toxicFlowSellRatioThreshold,
          },
        });
      }

      if (sellRatio >= toxicFlowSellRatioThreshold) {
        this.logger.debug(
          `Toxic flow ${tick.conditionId} asset ${assetId}: ${sellCount}/${recentTrades.length} sells (${(sellRatio * 100).toFixed(0)}%) in ${toxicFlowWindowMs}ms`,
        );
        return false;
      }
    }

    return true;
  }

  public recordTrade(event: TradeEvent) {
    const history = getOrCreateList(this.tradeHistory, event.conditionId);
    history.push({
      assetId: event.assetId,
      side: event.side,
      timestamp: event.timestamp,
    });

    const cutoff = Date.now() - this.environmentService.environment.toxicFlowWindowMs;
    this.pruneOldEntries(history, cutoff);
  }
  // #endregion

  // #region kinematics
  private calculateKinematics({
    conditionId,
    currentYes,
    currentNo,
  }: {
    conditionId: string;
    currentYes: number;
    currentNo: number;
  }): { yesAdj: number; noAdj: number } | null {
    const history = this.priceHistory.get(conditionId);
    if (!history || history.length < 3) {
      return null;
    }

    // Look back 2 seconds and 4 seconds
    const now = Date.now();
    const t1 = now - 2000;
    const t2 = now - 4000;

    if (history[0].timestamp > t2) {
      return null;
    }

    // Find nearest history points
    const p1 = history.find((h) => h.timestamp <= t1);
    const p2 = history.find((h) => h.timestamp <= t2);
    if (!p1 || !p2) {
      return null;
    }

    // --- YES SIDE KINEMATICS ---
    const vYes0 = currentYes - p1.yesPrice;
    const vYes1 = p1.yesPrice - p2.yesPrice;
    const aYes = vYes0 - vYes1;

    // --- NO SIDE KINEMATICS ---
    const vNo0 = currentNo - p1.noPrice;
    const vNo1 = p1.noPrice - p2.noPrice;
    const aNo = vNo0 - vNo1;

    // PREDICTION FORMULA:
    // Future ≈ Current + (V * k1) + (A * k2)
    const { velocityFactor, accelerationFactor, maxDiscount } = this.environmentService.environment;
    const yesAdj = Math.max(-maxDiscount, Math.min(vYes0 * velocityFactor + aYes * accelerationFactor, 0));
    const noAdj = Math.max(-maxDiscount, Math.min(vNo0 * velocityFactor + aNo * accelerationFactor, 0));

    return { yesAdj, noAdj };
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
    const config = this.environmentService.environment;

    // A. Base Calculation
    const currentSpread = tick.bestBidYes + tick.bestBidNo;
    const baseDiscount = Math.max((currentSpread - config.targetEntry) / 2, 0);

    let targetYes = tick.bestBidYes - baseDiscount;
    let targetNo = tick.bestBidNo - baseDiscount;

    // B. Momentum Adjustment (Kinematics)
    if (config.enableMomentumDiscounting) {
      const kinematics = this.calculateKinematics({
        conditionId: tick.conditionId,
        currentYes: tick.bestBidYes,
        currentNo: tick.bestBidNo,
      });

      // If warming up, we can't trade yet
      if (!kinematics) {
        return null;
      }

      targetYes = Math.min(targetYes + kinematics.yesAdj, tick.bestBidYes);
      targetNo = Math.min(targetNo + kinematics.noAdj, tick.bestBidNo);
    }

    // C. Fill Gap Cap — prevent one-legged fills from asymmetric momentum
    // Clamp each target so it's never more than maxAskDistance below the best ask.
    if (config.enableFillGapCap) {
      if (tick.bestAskYes > 0) {
        targetYes = Math.max(targetYes, tick.bestAskYes - config.maxAskDistance);
      }
      if (tick.bestAskNo > 0) {
        targetNo = Math.max(targetNo, tick.bestAskNo - config.maxAskDistance);
      }
    }

    // D. Rounding (Polymarket Requirement)
    targetYes = this.roundDown(targetYes, tick.minTickSize);
    targetNo = this.roundDown(targetNo, tick.minTickSize);

    // E. Total Cost Ceiling — reject if fill gap cap pushed cost above target entry
    const totalCost = targetYes + targetNo;
    if (totalCost > config.targetEntry) {
      return null;
    }

    // F. Sanity Checks
    // 1. Must be positive
    if (targetYes <= 0 || targetNo <= 0) {
      return null;
    }

    // 2. Must be better than current market (Maker only)
    if (targetYes > tick.bestBidYes || targetNo > tick.bestBidNo) {
      this.logger.warn(`Alpha generated taker orders for ${tick.conditionId}. Skipping.`);
      return null;
    }

    // 3. Probabilities must sum to <= 1.0 (Arbitrage check)
    if (targetYes + targetNo > 1.0) {
      return null;
    }

    return {
      conditionId: tick.conditionId,
      targetYes,
      targetNo,
      quantity: config.targetPositionSize,
      reason: `Spread: ${currentSpread.toFixed(3)} | Discount: ${baseDiscount.toFixed(3)} | Total: ${totalCost.toFixed(3)}`,
    };
  }

  private roundDown(value: number, tickSize: TickSize): number {
    const factor = 1 / parseFloat(tickSize);
    return Math.floor(value * factor) / factor;
  }
  // #endregion
}
