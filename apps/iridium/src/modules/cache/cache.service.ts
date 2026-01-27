import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';

@Injectable()
export class CacheService {
  /**
   * Key: cache symbol (asset-ISO)\
   * Value: Market object
   */
  public readonly markets = new Map<string, Market>();

  /**
   * Key: asset id\
   * Value:
   *  - bids: Array of [price, size] tuples sorted by price descending
   *  - asks: Array of [price, size] tuples sorted by price ascending
   */
  public readonly orderBook = new Map<string, { bids: [number, number][]; asks: [number, number][] }>();
}
