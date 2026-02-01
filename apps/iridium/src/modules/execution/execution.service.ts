import { Injectable, Logger } from '@nestjs/common';

import { CacheService } from '../cache/cache.service';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(private readonly cacheService: CacheService) {}

  public async placeLimitOrder({
    marketId,
    targetYes,
    targetNo,
  }: {
    marketId: string;
    targetYes: number;
    targetNo: number;
  }) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const market = this.cacheService.markets.get(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found in cache`);
    }

    const { yesToken, noToken } = market;
    if (!yesToken || !noToken) {
      throw new Error(`Tokens for market ${marketId} are not available`);
    }

    this.logger.log(`Placing limit orders on market ${marketId}: Yes Token @ ${targetYes}, No Token @ ${targetNo}`);
  }
}
