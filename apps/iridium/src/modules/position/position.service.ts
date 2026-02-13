import { Injectable } from '@nestjs/common';

export type ActiveStraddle = {
  conditionId: string;

  // Order IDs
  yesOrderId: string;
  noOrderId: string;

  // Order parameters (needed for refund calculations)
  yesPrice: number;
  noPrice: number;
  quantity: number;

  // "Bag" - The shares we currently hold (Available to Merge)
  yesHoldings: number;
  noHoldings: number;

  // API State - Used to calculate Deltas & Status
  yesCumulativeFilled: number; // The 'size_matched' from last message
  noCumulativeFilled: number; // The 'size_matched' from last message

  yesStatus: 'OPEN' | 'FILLED' | 'CANCELED';
  noStatus: 'OPEN' | 'FILLED' | 'CANCELED';

  // Stop-loss timing
  placedAt: number; // Date.now() at placement

  // Concurrency control
  skewInProgress: boolean;
  skewApplied: boolean;
};

type ConditionId = string;

@Injectable()
export class PositionService {
  private readonly activeStraddles = new Map<ConditionId, ActiveStraddle>();
  private readonly marketsInProgress = new Set<ConditionId>();

  public getStraddle(conditionId: ConditionId): ActiveStraddle | undefined {
    return this.activeStraddles.get(conditionId);
  }

  public addStraddle(straddle: ActiveStraddle) {
    this.activeStraddles.set(straddle.conditionId, straddle);
  }

  public removeStraddle(conditionId: ConditionId) {
    this.activeStraddles.delete(conditionId);
  }

  public getStraddles(): ActiveStraddle[] {
    return Array.from(this.activeStraddles.values());
  }

  public get straddleCount(): number {
    return this.activeStraddles.size;
  }

  public isMarketInProgress(conditionId: ConditionId): boolean {
    return this.marketsInProgress.has(conditionId) || this.activeStraddles.has(conditionId);
  }

  public setMarketInProgress(conditionId: ConditionId, isInProgress: boolean) {
    if (isInProgress) {
      this.marketsInProgress.add(conditionId);
    } else {
      this.marketsInProgress.delete(conditionId);
    }
  }
}
