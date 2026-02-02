import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClobClient, OrderType, Side, TickSize } from '@polymarket/clob-client';

import { RelayerService } from './relayer.service';
import { CLOB_API_BASE, POLYGON_CHAIN_ID } from '../../constants/constants';
import { EnvironmentService } from '../../environment/environment-service';
import { AuthService } from '../auth/auth.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class ExecutionService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionService.name);

  private isConfigured = false;
  private clobClient: ClobClient | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly cacheService: CacheService,
    private readonly relayerService: RelayerService,
    private readonly environmentService: EnvironmentService,
  ) {}

  // MARK: module/client init
  onModuleInit() {
    this.logger.log('Initializing Polymarket CLOB client...');
    this.authService.authBundle$.subscribe(({ wallet, credentials }) => {
      this.clobClient = new ClobClient(
        CLOB_API_BASE,
        POLYGON_CHAIN_ID,
        wallet,
        credentials,
        this.environmentService.environment.signatureType,
        this.environmentService.environment.funderAddress,
      );
      this.isConfigured = true;
    });
  }

  // MARK: place limit order
  public async placeLimitOrder({
    conditionId,
    targetYes,
    targetNo,
    quantity,
  }: {
    conditionId: string;
    targetYes: number;
    targetNo: number;
    quantity: number;
  }): Promise<{
    yesOrderId: string;
    noOrderId: string;
  }> {
    if (!this.isConfigured || !this.clobClient) {
      throw new Error('CLOB client is not configured');
    }

    const { yesTokenId, noTokenId, minimumTickSize } = this.getMarketMetadata(conditionId);
    this.logger.log(
      `Placing limit orders on condition ${conditionId}: Yes Token @ ${targetYes}, No Token @ ${targetNo} for quantity ${quantity}`,
    );

    const [yesOrderResponse, noOrderResponse] = await Promise.all([
      this.clobClient.createAndPostOrder(
        { tokenID: yesTokenId, price: targetYes, side: Side.BUY, size: quantity },
        { tickSize: minimumTickSize },
        OrderType.GTC,
      ),
      this.clobClient.createAndPostOrder(
        { tokenID: noTokenId, price: targetNo, side: Side.BUY, size: quantity },
        { tickSize: minimumTickSize },
        OrderType.GTC,
      ),
    ]);

    // polymarket docs are inconsistent with orderID vs orderId
    const yesOrderId = yesOrderResponse.orderID || yesOrderResponse.orderId;
    const noOrderId = noOrderResponse.orderID || noOrderResponse.orderId;

    if (!yesOrderResponse.success || !yesOrderId) {
      throw new Error(`Failed to place YES order: ${yesOrderResponse.errorMsg ?? 'Unknown error'}`);
    }

    if (!noOrderResponse.success || !noOrderId) {
      // Cancel the YES order if the NO order fails
      await this.clobClient.cancelOrder({ orderID: yesOrderId });
      throw new Error(`Failed to place NO order: ${noOrderResponse.errorMsg ?? 'Unknown error'}`);
    }

    this.logger.log(`Successfully placed orders: YES=${yesOrderId}, NO=${noOrderId}`);
    return {
      yesOrderId,
      noOrderId,
    };
  }

  // MARK: cancel order
  public async cancelOrder(orderId: string) {
    if (!this.clobClient || !this.isConfigured) {
      throw new Error('CLOB client is not configured');
    }
    await this.clobClient.cancelOrder({ orderID: orderId });
    this.logger.log(`Cancelled order ${orderId}`);
  }

  // MARK: sell market position
  public async sellMarketPosition({
    conditionId,
    yesAmount,
    noAmount,
  }: {
    conditionId: string;
    yesAmount: number;
    noAmount: number;
  }) {
    if (!this.isConfigured || !this.clobClient) {
      throw new Error('CLOB client is not configured');
    }

    if (yesAmount === 0 && noAmount === 0) {
      return;
    }

    const { yesTokenId, noTokenId, minimumTickSize } = this.getMarketMetadata(conditionId);

    this.logger.warn(`PANIC SELL on ${conditionId}: Yes=${yesAmount}, No=${noAmount}`);

    // PRICE STRATEGY:
    // We sell at 0.01. The engine matches us with the highest bidder.
    // If BestBid is 0.50, we get 0.50.
    const panicPrice = 0.01;
    const promises = [];

    // It's okay to use GTC here because any amount of selling is better than losing the entire position.
    const type = OrderType.GTC;

    if (yesAmount > 0) {
      promises.push(
        this.clobClient
          .createAndPostOrder(
            { tokenID: yesTokenId, price: panicPrice, side: Side.SELL, size: yesAmount },
            { tickSize: minimumTickSize },
            type,
          )
          .then((res) => this.logSellResult(res, 'YES')),
      );
    }

    if (noAmount > 0) {
      promises.push(
        this.clobClient
          .createAndPostOrder(
            { tokenID: noTokenId, price: panicPrice, side: Side.SELL, size: noAmount },
            { tickSize: minimumTickSize },
            type,
          )
          .then((res) => this.logSellResult(res, 'NO')),
      );
    }

    await Promise.all(promises);
  }

  // MARK: merge positions
  public mergePositions({ conditionId, amount }: { conditionId: string; amount: number }) {
    return this.relayerService.mergePositions({ conditionId, amount });
  }

  // #region helper methods
  private logSellResult(response: Awaited<ReturnType<typeof ClobClient.prototype.createAndPostOrder>>, side: string) {
    if (response.success) {
      this.logger.log(`Panic Sell ${side} Success: Order ${response.orderID}`);
    } else {
      this.logger.error(`Panic Sell ${side} Failed: ${response.errorMsg}`);
    }
  }

  private getMarketMetadata(conditionId: string): { yesTokenId: string; noTokenId: string; minimumTickSize: TickSize } {
    const market = this.cacheService.markets.get(conditionId);
    if (!market) {
      throw new Error(`Market ${conditionId} not found in cache`);
    }

    const { yesToken, noToken } = market;
    if (!yesToken || !noToken) {
      throw new Error(`Tokens for market ${conditionId} are not available`);
    }

    return { yesTokenId: yesToken, noTokenId: noToken, minimumTickSize: market.orderPriceMinTickSize };
  }
  // #endregion
}
