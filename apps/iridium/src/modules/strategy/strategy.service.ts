import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { filter, throttleTime } from 'rxjs';

import { ClobWsService, MarketTick } from '../clob/ws/clob-ws.service';

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  constructor(private readonly clobWsService: ClobWsService) {}

  onModuleInit() {
    this.clobWsService.marketTicks$
      .pipe(
        filter((tick) => {
          console.log(
            `Received tick for market ${tick.marketId}: Yes Bid = ${tick.bestBidYes}, No Bid = ${tick.bestBidNo}`,
          );

          const totalCost = tick.bestBidYes + tick.bestBidNo;
          return totalCost > 0.9 && totalCost < 1.01;
        }),
        throttleTime(100),
      )
      .subscribe((tick) => {
        this.evaluateStraddle(tick);
      });
  }

  private evaluateStraddle(tick: MarketTick) {
    const currentSpread = tick.bestBidYes + tick.bestBidNo;
    const targetBid = currentSpread / 2 - 0.01;
    this.logger.log(
      `Opportunity on ${tick.marketId}: Combined Bid is ${currentSpread}. Placing limits at ${targetBid}`,
    );
  }
}
