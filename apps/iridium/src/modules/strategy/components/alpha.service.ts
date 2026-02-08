import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { EnvironmentService } from '../../../environment/environment-service';
import { MarketTick } from '../../clob/ws/market-ws.service';

type PriceHistoryEntry = {
  yesPrice: number;
  noPrice: number;
  timestamp: number;
};

type ConditionId = string;

@Injectable()
export class AlphaService implements OnModuleDestroy {
  private readonly logger = new Logger(AlphaService.name);

  private readonly priceHistory = new Map<ConditionId, PriceHistoryEntry[]>();
  private readonly lastEvaluationTimestamp = new Map<ConditionId, number>();

  constructor(private readonly environmentService: EnvironmentService) {}

  onModuleDestroy() {
    this.logger.debug('Shutting down alpha service...');
    this.lastEvaluationTimestamp.clear();
    this.priceHistory.clear();
  }

  // #region tapping
  public recordPriceHistory(tick: MarketTick) {
    if (tick.bestBidYes <= 0.01 || tick.bestBidNo <= 0.01 || tick.bestBidYes >= 0.99 || tick.bestBidNo >= 0.99) {
      return;
    }

    const history = this.getPriceHistory(tick.conditionId);
    history.push({
      yesPrice: tick.bestBidYes,
      noPrice: tick.bestBidNo,
      timestamp: Date.now(),
    });

    const cutoffTime = tick.timestamp - this.environmentService.environment.maxHistoryRetentionMs;
    const idx = history.findIndex((h) => h.timestamp >= cutoffTime);
    if (idx > 0) {
      history.splice(0, idx);
    }
  }

  public recordEvaluation(conditionId: ConditionId) {
    this.lastEvaluationTimestamp.set(conditionId, Date.now());
  }
  // #endregion

  // #region filters
  public filterForTimeRemaining(tick: MarketTick): boolean {
    if (tick.timeRemaining > this.environmentService.environment.maxTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too much)`);
      return false;
    }

    if (tick.timeRemaining <= this.environmentService.environment.minTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too little)`);
      return false;
    }

    return true;
  }

  public filterForSkew(tick: MarketTick): boolean {
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

  public filterForThrottling(tick: MarketTick): boolean {
    const now = Date.now();
    const lastTime = this.lastEvaluationTimestamp.get(tick.conditionId) ?? 0;
    return now - lastTime >= 100;
  }

  public filterForStability(tick: MarketTick): boolean {
    const { priceStabilityRangeCents, priceStabilityDurationMs, enablePriceStabilityCheck } =
      this.environmentService.environment;

    if (!enablePriceStabilityCheck) {
      return true;
    }
    if (!priceStabilityRangeCents || !priceStabilityDurationMs) {
      return true;
    }

    const history = this.priceHistory.get(tick.conditionId);

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

  // #endregion

  // #region kinematics
  public calculateKinematics({
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
  private getPriceHistory(conditionId: ConditionId): PriceHistoryEntry[] {
    const existingHistory = this.priceHistory.get(conditionId);
    if (existingHistory) {
      return existingHistory;
    }

    const newHistory: PriceHistoryEntry[] = [];
    this.priceHistory.set(conditionId, newHistory);
    return newHistory;
  }

  public deleteCondition(conditionId: ConditionId) {
    this.priceHistory.delete(conditionId);
    this.lastEvaluationTimestamp.delete(conditionId);
  }
  // #endregion
}
