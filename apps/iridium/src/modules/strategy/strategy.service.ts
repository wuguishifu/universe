import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { filter, throttleTime } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { OrderMessage } from '../../types/clob/orderMessage';
import { MarketTick, MarketWsService } from '../clob/ws/market-ws.service';
import { UserWsService } from '../clob/ws/user-ws.service';
import { ExecutionService } from '../execution/execution.service';

interface ActiveStraddle {
  conditionId: string;

  // Order IDs
  yesOrderId: string;
  noOrderId: string;

  // "Bag" - The shares we currently hold (Available to Merge)
  yesHoldings: number;
  noHoldings: number;

  // API State - Used to calculate Deltas & Status
  yesCumulativeFilled: number; // The 'size_matched' from last message
  noCumulativeFilled: number; // The 'size_matched' from last message

  yesStatus: 'OPEN' | 'FILLED' | 'CANCELED';
  noStatus: 'OPEN' | 'FILLED' | 'CANCELED';

  // Legging risk timer
  timer?: NodeJS.Timeout;
}

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  /** conditionId -> StraddleState */
  private readonly activeStraddles = new Map<string, ActiveStraddle>();

  /** conditionId being processed */
  private readonly marketsInProgress = new Set<string>();

  /** orderId -> conditionId */
  private readonly orderMap = new Map<string, string>();

  constructor(
    private readonly userWsService: UserWsService,
    private readonly marketWsService: MarketWsService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  onModuleInit() {
    // entry pipe
    this.marketWsService.marketTicks$
      .pipe(
        // MARK: filter for valid straddle opportunities
        filter((tick) => {
          const totalCost = tick.bestBidYes + tick.bestBidNo;
          if (totalCost <= 0.9) {
            this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too low)`);
            return false;
          }

          if (totalCost >= 1.01) {
            this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too high)`);
            return false;
          }

          return true;
        }),
        // MARK: filter for time remaining
        filter((tick) => {
          if (tick.timeRemaining <= this.environmentService.environment.minTimeRemainingMs) {
            this.logger.debug(
              `Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too little)`,
            );
            return false;
          }

          if (tick.timeElapsed <= this.environmentService.environment.minTimeElapsedMs) {
            this.logger.debug(
              `Skipping market ${tick.conditionId} with time elapsed ${tick.timeElapsed}ms (too little)`,
            );
            return false;
          }

          return true;
        }),
        // MARK: throttle to avoid rapid re-evaluation
        throttleTime(100),
      )
      .subscribe((tick) => {
        this.evaluateStraddle(tick);
      });

    // lifecycle pipe
    this.userWsService.orderUpdates$.subscribe((update) => this.handleOrderUpdate(update));
  }

  private async evaluateStraddle(tick: MarketTick) {
    // MARK: skip if already active or in progress
    if (this.activeStraddles.has(tick.conditionId) || this.marketsInProgress.has(tick.conditionId)) {
      return;
    }

    // MARK: calculate target bids
    const targetEntry = this.environmentService.environment.targetEntry;
    const currentSpread = tick.bestBidYes + tick.bestBidNo;
    const targetDiscount = Math.max((currentSpread - targetEntry) / 2, 0);

    const targetYes = this.roundDown(tick.bestBidYes - targetDiscount, tick.minTickSize);
    const targetNo = this.roundDown(tick.bestBidNo - targetDiscount, tick.minTickSize);
    if (targetYes <= 0 || targetNo <= 0) {
      return;
    }

    if (targetYes > tick.bestBidYes || targetNo > tick.bestBidNo) {
      this.logger.warn(`Calculated target bids are worse than current bids for market ${tick.conditionId}. Skipping.`);
      return;
    }

    if (targetYes + targetNo > 1.0) {
      return;
    }

    this.marketsInProgress.add(tick.conditionId);
    this.logger.log(
      `Opportunity on ${tick.conditionId} (Skew: ${tick.bestBidYes}/${tick.bestBidNo}). Placing Skewed Limits: Yes@${targetYes} | No@${targetNo}`,
    );

    try {
      // MARK: place limit orders
      const { yesOrderId, noOrderId } = await this.executionService.placeLimitOrder({
        conditionId: tick.conditionId,
        targetYes,
        targetNo,
        quantity: this.environmentService.environment.targetPositionSize,
      });

      this.activeStraddles.set(tick.conditionId, {
        conditionId: tick.conditionId,
        yesOrderId,
        noOrderId,
        yesHoldings: 0,
        noHoldings: 0,
        yesCumulativeFilled: 0,
        noCumulativeFilled: 0,
        yesStatus: 'OPEN',
        noStatus: 'OPEN',
      });
      this.orderMap.set(yesOrderId, tick.conditionId);
      this.orderMap.set(noOrderId, tick.conditionId);
      this.marketsInProgress.delete(tick.conditionId);
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${tick.conditionId}: ${(error as Error).message}`);
      this.marketsInProgress.delete(tick.conditionId);
    }
  }

  private handleOrderUpdate(update: OrderMessage) {
    // MARK: find context
    const conditionId = this.orderMap.get(update.id);
    if (!conditionId) {
      this.logger.warn(`Received order update for unknown orderId: ${update.id}`);
      return;
    }

    const straddle = this.activeStraddles.get(conditionId);
    if (!straddle) {
      this.logger.warn(`No active straddle found for conditionId: ${conditionId}`);
      return;
    }

    // MARK: update state
    let delta = 0;
    const newMatchedSize = parseFloat(update.size_matched);
    const originalSize = parseFloat(update.original_size);

    // MARK: update state
    if (update.id === straddle.yesOrderId) {
      delta = newMatchedSize - straddle.yesCumulativeFilled;
      straddle.yesCumulativeFilled = newMatchedSize;
      if (delta > 0) {
        straddle.yesHoldings += delta;
      }

      if (update.type === 'CANCELLATION') {
        straddle.yesStatus = 'CANCELED';
      } else if (newMatchedSize >= originalSize) {
        straddle.yesStatus = 'FILLED';
      } else {
        straddle.yesStatus = 'OPEN';
      }
    } else if (update.id === straddle.noOrderId) {
      delta = newMatchedSize - straddle.noCumulativeFilled;
      straddle.noCumulativeFilled = newMatchedSize;
      if (delta > 0) {
        straddle.noHoldings += delta;
      }

      if (update.type === 'CANCELLATION') {
        straddle.noStatus = 'CANCELED';
      } else if (newMatchedSize >= originalSize) {
        straddle.noStatus = 'FILLED';
      } else {
        straddle.noStatus = 'OPEN';
      }
    }

    // MARK: check for merge
    const match = Math.min(straddle.yesHoldings, straddle.noHoldings);
    if (match > 0) {
      straddle.yesHoldings -= match;
      straddle.noHoldings -= match;

      this.logger.log(`Merging ${match} positions on condition ${conditionId}`);
      this.executionService.mergePositions({ conditionId, amount: match });
    }

    // MARK: check for complete exit
    const isYesDone = straddle.yesStatus === 'FILLED' || straddle.yesStatus === 'CANCELED';
    const isNoDone = straddle.noStatus === 'FILLED' || straddle.noStatus === 'CANCELED';
    if (isYesDone && isNoDone) {
      // ensure we don't delete while pending a merge
      if (straddle.yesHoldings < 0.001 && straddle.noHoldings < 0.001) {
        this.logger.log(`Straddle on condition ${conditionId} is complete. Cleaning up state.`);
        this.cleanupStraddle(straddle);
        return;
      }
    }

    // MARK: risk timer
    const imbalance = Math.abs(straddle.yesHoldings - straddle.noHoldings);
    if (imbalance > 0 && !straddle.timer) {
      this.logger.warn(`Starting legging risk timer for ${conditionId}`);
      straddle.timer = setTimeout(() => this.panicExit(straddle), this.environmentService.environment.panicExitDelayMs);
    } else if (imbalance === 0 && straddle.timer) {
      this.logger.debug(`Clearing legging risk timer for ${conditionId}`);
      clearTimeout(straddle.timer);
      straddle.timer = undefined;
    }
  }

  private async cleanupStraddle(straddle: ActiveStraddle) {
    this.logger.debug(`Cleaning up straddle for condition ${straddle.conditionId}`);

    this.activeStraddles.delete(straddle.conditionId);
    this.orderMap.delete(straddle.yesOrderId);
    this.orderMap.delete(straddle.noOrderId);
    if (straddle.timer) {
      clearTimeout(straddle.timer);
    }

    if (Math.abs(straddle.yesHoldings - straddle.noHoldings) > 0.001) {
      this.logger.warn(
        `Significant holdings remain for condition ${straddle.conditionId} during cleanup: Yes=${straddle.yesHoldings}, No=${straddle.noHoldings}`,
      );
      await this.panicExit(straddle);
    }

    this.logger.debug(`Straddle for condition ${straddle.conditionId} has been cleaned up.`);
  }

  private async panicExit(straddle: ActiveStraddle) {
    this.logger.error(`Legging risk timer expired for ${straddle.conditionId}. Initiating panic exit.`);
    await Promise.all([
      this.executionService.cancelOrder(straddle.yesOrderId),
      this.executionService.cancelOrder(straddle.noOrderId),
    ]);

    if (straddle.yesHoldings || straddle.noHoldings) {
      this.executionService
        .sellMarketPosition({
          conditionId: straddle.conditionId,
          yesAmount: straddle.yesHoldings,
          noAmount: straddle.noHoldings,
        })
        .catch((error) => {
          this.logger.error(
            `Failed to execute panic sell on condition ${straddle.conditionId}: ${(error as Error).message}`,
          );
        });
    }
  }

  /** Rounds down to 2 decimal places (requirement by PolyMarket) */
  private roundDown(value: number, tickSize: TickSize): number {
    const factor = 1 / parseFloat(tickSize);
    return Math.floor(value * factor) / factor;
  }
}
