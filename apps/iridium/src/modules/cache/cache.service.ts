import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';
import { OrderBook } from '../../types/order-book';
import { Straddle } from '../../types/straddle';

@Injectable()
export class CacheService {
  /** Map of cache key -> market */
  public readonly markets = new Map<string, Market>();

  /** Map of asset ID -> order book */
  public readonly orderBooks = new Map<string, OrderBook>();

  /** Map of market cache key -> straddle state */
  public readonly straddles = new Map<string, Straddle>();
}
