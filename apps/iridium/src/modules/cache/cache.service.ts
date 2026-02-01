import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';
import { OrderBook } from '../../types/order-book';

@Injectable()
export class CacheService {
  /** Map of cache key -> market */
  public readonly markets = new Map<string, Market>();

  /** Map of asset ID -> order book */
  public readonly orderBooks = new Map<string, OrderBook>();
}
