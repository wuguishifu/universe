import { Injectable } from '@nestjs/common';

import { Market } from '@wuguishifu/utils-polymarket';

@Injectable()
export class CacheService {
  /** Map of conditionId -> market */
  public readonly markets = new Map<string, Market>();
}
