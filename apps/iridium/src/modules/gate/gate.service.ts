import { LocalEnvironmentService } from '@wuguishifu/nest-common';

import { environmentSchema } from '../../environment/environment-schema';
import { Market } from '../../types/market';
import { OrderBook } from '../../types/order-book';
import { getTimeRemainingMs } from '../../utils/market.utils';
import { getBestPrice, getDepth, getSpreadRatio } from '../../utils/order-book.utils';

const ONE_HOUR = 60 * 60 * 1000;

export class GateService {
  constructor(private readonly environmentService: LocalEnvironmentService<typeof environmentSchema>) {}

  public checkAll(market: Market, yesBook: OrderBook, noBook: OrderBook) {
    return (
      this.checkTime(market) &&
      this.checkDepth(yesBook, noBook) &&
      this.checkMarketBalance(yesBook, noBook) &&
      this.checkSpread(yesBook, noBook)
    );
  }

  public checkDepth(yesBook: OrderBook, noBook: OrderBook) {
    const yesDepth = getDepth(yesBook);
    const noDepth = getDepth(noBook);
    const minDepth = yesDepth < noDepth ? yesDepth : noDepth;
    return minDepth >= this.environmentService.environment.minDepthUsd;
  }

  public checkTime(market: Market) {
    const timeRemaining = getTimeRemainingMs(market);
    return timeRemaining >= this.environmentService.environment.minRemainingTimeMs && timeRemaining < ONE_HOUR;
  }

  public checkMarketBalance(yesBook: OrderBook, noBook: OrderBook) {
    const bestYesPrice = getBestPrice(yesBook);
    const bestNoPrice = getBestPrice(noBook);

    return (
      bestYesPrice &&
      this.environmentService.environment.minBalancedPrice <= bestYesPrice &&
      bestYesPrice <= this.environmentService.environment.maxBalancedPrice &&
      bestNoPrice &&
      this.environmentService.environment.minBalancedPrice <= bestNoPrice &&
      bestNoPrice <= this.environmentService.environment.maxBalancedPrice
    );
  }

  public checkSpread(yesBook: OrderBook, noBook: OrderBook) {
    const yesSpread = getSpreadRatio(yesBook);
    const noSpread = getSpreadRatio(noBook);
    if (!yesSpread || !noSpread) {
      return false;
    }

    const maxSpread = yesSpread > noSpread ? yesSpread : noSpread;
    return maxSpread <= this.environmentService.environment.maxSpreadRatio;
  }
}
