import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';

@Injectable()
export class CacheService {
  /** Map of conditionId -> market */
  public readonly markets = new Map<string, Market>();
}
