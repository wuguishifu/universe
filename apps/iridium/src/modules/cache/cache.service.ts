import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';

@Injectable()
export class CacheService {
  // TODO: redis cache service for persistence
  /** Map of conditionId -> market */
  public readonly markets = new Map<string, Market>();
}
