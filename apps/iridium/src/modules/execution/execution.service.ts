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
    quantity,
  }: {
    marketId: string;
    targetYes: number;
    targetNo: number;
    quantity: number;
  }): Promise<{
    yesOrderId: string;
    noOrderId: string;
  }> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const market = this.cacheService.markets.get(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found in cache`);
    }

    const { yesToken, noToken } = market;
    if (!yesToken || !noToken) {
      throw new Error(`Tokens for market ${marketId} are not available`);
    }

    this.logger.log(
      `Placing limit orders on market ${marketId}: Yes Token @ ${targetYes}, No Token @ ${targetNo} for quantity ${quantity}`,
    );

    return {
      yesOrderId: `order-${yesToken}-${Date.now()}`,
      noOrderId: `order-${noToken}-${Date.now()}`,
    };
  }

  public async sellMarketPosition({
    marketId,
    yesAmount,
    noAmount,
  }: {
    marketId: string;
    yesAmount: number;
    noAmount: number;
  }) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.logger.log(`Selling market positions on market ${marketId}: Yes Amount: ${yesAmount}, No Amount: ${noAmount}`);
  }

  public async mergePositions({ marketId, amount }: { marketId: string; amount: number }) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.logger.log(`Merging ${amount} positions on market ${marketId}`);
  }

  public async cancelOrder(orderId: string) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.logger.log(`Cancelling order ${orderId}`);
  }
}
