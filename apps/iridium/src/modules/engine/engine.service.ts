import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';
import { isExpired } from '../../utils/market.utils';
import { getBestPrice } from '../../utils/order-book.utils';
import { CacheService } from '../cache/cache.service';
import { GateService } from '../gate/gate.service';

@Injectable()
export class EngineService {
  constructor(
    private readonly gateService: GateService,
    private readonly cacheService: CacheService,
  ) {}

  public evaluateMarket(market: Market) {
    if (isExpired(market)) {
      return;
    }

    if (!this.gateService.checkTime(market)) {
      return;
    }

    const yesBook = this.cacheService.orderBooks.get(market.yesToken);
    const noBook = this.cacheService.orderBooks.get(market.noToken);
    if (!yesBook || !noBook) {
      return;
    }

    const bestYesPrice = getBestPrice(yesBook);
    const bestNoPrice = getBestPrice(noBook);
    if (!bestYesPrice || !bestNoPrice) {
      return;
    }
  }
}
