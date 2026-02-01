import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { filter, throttleTime } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { ClobWsService, MarketTick } from '../clob/ws/clob-ws.service';
import { ExecutionService } from '../execution/execution.service';

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  private readonly activeMarkets = new Set<string>();

  constructor(
    private readonly clobWsService: ClobWsService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  onModuleInit() {
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
  }

  private async evaluateStraddle(tick: MarketTick) {
    if (this.activeMarkets.has(tick.marketId)) {
      return;
    }

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

    this.activeMarkets.add(tick.marketId);
    this.logger.log(
      `Opportunity on ${tick.marketId} (Skew: ${tick.bestBidYes}/${tick.bestBidNo}). Placing Skewed Limits: Yes@${targetYes} | No@${targetNo}`,
    );

    try {
      await this.executionService.placeLimitOrder({ marketId: tick.marketId, targetYes, targetNo });
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${tick.marketId}: ${(error as Error).message}`);
      this.activeMarkets.delete(tick.marketId);
    }
  }

  /** Rounds down to 3 decimal places (requirement by PolyMarket) */
  private roundDown(value: number): number {
    return Math.floor(value * 1000) / 1000;
  }
}
