import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { filter, throttleTime } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { OrderMessage } from '../../types/clob/orderMessage';
import { ClobWsService, MarketTick } from '../clob/ws/clob-ws.service';
import { ExecutionService } from '../execution/execution.service';

interface ActiveStraddle {
  marketId: string;

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

  /** marketId -> StraddleState */
  private readonly activeStraddles = new Map<string, ActiveStraddle>();

  /** marketIds being processed */
  private readonly marketsInProgress = new Set<string>();

  /** orderId -> marketId */
  private readonly orderMap = new Map<string, string>();

  constructor(
    private readonly clobWsService: ClobWsService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  onModuleInit() {
    // entry pipe
    this.clobWsService.marketTicks$
      .pipe(
        filter((tick) => {
          const totalCost = tick.bestBidYes + tick.bestBidNo;
          return totalCost > 0.9 && totalCost < 1.01;
        }),
        filter(
          (tick) =>
            tick.timeRemaining >= this.environmentService.environment.minTimeRemainingMs &&
            tick.timeRemaining <= this.environmentService.environment.minTimeElapsedMs,
        ),
        throttleTime(100),
      )
      .subscribe((tick) => {
        this.evaluateStraddle(tick);
      });

    // lifecycle pipe
    this.clobWsService.orderUpdates$.subscribe((update) => this.handleOrderUpdate(update));
  }

  private async evaluateStraddle(tick: MarketTick) {
    // MARK: skip if already active or in progress
    if (this.activeStraddles.has(tick.marketId) || this.marketsInProgress.has(tick.marketId)) {
      return;
    }

    // MARK: calculate target bids
    const targetEntry = this.environmentService.environment.targetEntry;
    const currentSpread = tick.bestBidYes + tick.bestBidNo;
    const targetDiscount = Math.max((currentSpread - targetEntry) / 2, 0);

    const targetYes = this.roundDown(tick.bestBidYes - targetDiscount);
    const targetNo = this.roundDown(tick.bestBidNo - targetDiscount);
    if (targetYes <= 0 || targetNo <= 0) {
      return;
    }

    if (targetYes > tick.bestBidYes || targetNo > tick.bestBidNo) {
      this.logger.warn(`Calculated target bids are worse than current bids for market ${tick.marketId}. Skipping.`);
      return;
    }

    if (targetYes + targetNo > 1.0) {
      return;
    }

    this.marketsInProgress.add(tick.marketId);
    this.logger.log(
      `Opportunity on ${tick.marketId} (Skew: ${tick.bestBidYes}/${tick.bestBidNo}). Placing Skewed Limits: Yes@${targetYes} | No@${targetNo}`,
    );

    try {
      // MARK: place limit orders
      const { yesOrderId, noOrderId } = await this.executionService.placeLimitOrder({
        marketId: tick.marketId,
        targetYes,
        targetNo,
        quantity: this.environmentService.environment.targetPositionSize,
      });

      this.activeStraddles.set(tick.marketId, {
        marketId: tick.marketId,
        yesOrderId,
        noOrderId,
        yesHoldings: 0,
        noHoldings: 0,
        yesCumulativeFilled: 0,
        noCumulativeFilled: 0,
        yesStatus: 'OPEN',
        noStatus: 'OPEN',
      });
      this.orderMap.set(yesOrderId, tick.marketId);
      this.orderMap.set(noOrderId, tick.marketId);
      this.marketsInProgress.delete(tick.marketId);
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${tick.marketId}: ${(error as Error).message}`);
      this.marketsInProgress.delete(tick.marketId);
    }
  }

  private handleOrderUpdate(update: OrderMessage) {
    // MARK: find context
    const marketId = this.orderMap.get(update.id);
    if (!marketId) {
      this.logger.warn(`Received order update for unknown orderId: ${update.id}`);
      return;
    }

    const straddle = this.activeStraddles.get(marketId);
    if (!straddle) {
      this.logger.warn(`No active straddle found for marketId: ${marketId}`);
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

      this.logger.log(`Merging ${match} positions on market ${marketId}`);
      this.executionService.mergePositions({ marketId, amount: match });
    }

    // MARK: check for complete exit
    const isYesDone = straddle.yesStatus === 'FILLED' || straddle.yesStatus === 'CANCELED';
    const isNoDone = straddle.noStatus === 'FILLED' || straddle.noStatus === 'CANCELED';
    if (isYesDone && isNoDone) {
      // ensure we don't delete while pending a merge
      if (straddle.yesHoldings < 0.001 && straddle.noHoldings < 0.001) {
        this.logger.log(`Straddle on market ${marketId} is complete. Cleaning up state.`);
        this.cleanupStraddle(straddle);
        return;
      }
    }

    // MARK: risk timer
    const imbalance = Math.abs(straddle.yesHoldings - straddle.noHoldings);
    if (imbalance > 0 && !straddle.timer) {
      this.logger.warn(`Starting legging risk timer for ${marketId}`);
      straddle.timer = setTimeout(() => this.panicExit(straddle), this.environmentService.environment.panicExitDelayMs);
    } else if (imbalance === 0 && straddle.timer) {
      this.logger.debug(`Clearing legging risk timer for ${marketId}`);
      clearTimeout(straddle.timer);
      straddle.timer = undefined;
    }
  }

  private async cleanupStraddle(straddle: ActiveStraddle) {
    this.logger.debug(`Cleaning up straddle for market ${straddle.marketId}`);

    this.activeStraddles.delete(straddle.marketId);
    this.orderMap.delete(straddle.yesOrderId);
    this.orderMap.delete(straddle.noOrderId);
    if (straddle.timer) {
      clearTimeout(straddle.timer);
    }

    if (Math.abs(straddle.yesHoldings - straddle.noHoldings) > 0.001) {
      this.logger.warn(
        `Significant holdings remain for market ${straddle.marketId} during cleanup: Yes=${straddle.yesHoldings}, No=${straddle.noHoldings}`,
      );
      await this.panicExit(straddle);
    }

    this.logger.debug(`Straddle for market ${straddle.marketId} has been cleaned up.`);
  }

  private async panicExit(straddle: ActiveStraddle) {
    this.logger.error(`Legging risk timer expired for ${straddle.marketId}. Initiating panic exit.`);

    await Promise.all([
      this.executionService.cancelOrder(straddle.yesOrderId),
      this.executionService.cancelOrder(straddle.noOrderId),
    ]);

    if (straddle.yesHoldings || straddle.noHoldings) {
      this.executionService.sellMarketPosition({
        marketId: straddle.marketId,
        yesAmount: straddle.yesHoldings,
        noAmount: straddle.noHoldings,
      });
    }
  }

  /** Rounds down to 3 decimal places (requirement by PolyMarket) */
  private roundDown(value: number): number {
    return Math.floor(value * 100) / 100;
  }
}
