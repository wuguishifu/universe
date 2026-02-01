import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';
import { isExpired } from '../../utils/market.utils';

@Injectable()
export class EngineService {
  public evaluateMarket(market: Market) {
    if (isExpired(market)) {
      return;
    }
  }
}
