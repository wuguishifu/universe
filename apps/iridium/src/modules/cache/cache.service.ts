import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';

@Injectable()
export class CacheService {
  public readonly markets = new Map<string, Market>();
}
