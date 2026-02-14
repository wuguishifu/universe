import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClobClient, OpenOrder, OrderType, Side, TickSize } from '@polymarket/clob-client';
import { take } from 'rxjs';

import { OsmiumService } from '@wuguishifu/nest-common';

import { RelayerService } from './relayer.service';
import { EnvironmentService } from '../../environment/environment-service';
import { CacheService } from '../cache/cache.service';
import { ClobClientService } from '../clob/client/clob-client.service';

@Injectable()
export class ExecutionService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionService.name);

  private isConfigured = false;
  private clobClient: ClobClient | null = null;

  constructor(
    private readonly clobClientService: ClobClientService,
    private readonly cacheService: CacheService,
    private readonly relayerService: RelayerService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  // MARK: module/client init
  public onModuleInit() {
    this.logger.log(`Starting in ${this.environmentService.environment.dryRun ? 'DRY RUN' : 'LIVE'} mode`);
    this.logger.debug('Initializing Polymarket CLOB client...');
    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
      this.isConfigured = true;
    });
  }

  // MARK: place limit order
  public async placeLimitOrder(props: {
    conditionId: string;
    targetYes: number;
    targetNo: number;
    quantity: number;
  }): Promise<{
    yesOrderId: string;
    noOrderId: string;
  }> {
    const { conditionId, targetYes, targetNo, quantity } = props;

    if (!this.isConfigured || !this.clobClient) {
      throw new Error('CLOB client is not configured');
    }

    const { yesTokenId, noTokenId, minimumTickSize } = this.getMarketMetadata(conditionId);
    const commonTrackingProps = {
      ...props,
      dryRun: this.environmentService.environment.dryRun,
      yesTokenId,
      noTokenId,
      minimumTickSize,
    };

    this.osmiumService.trackEvent({
      name: 'execution_service-limit_order-place-started',
      metadata: commonTrackingProps,
    });
    this.logger.log(
      `Placing limit orders on condition ${conditionId}: Yes Token @ ${targetYes}, No Token @ ${targetNo} for quantity ${quantity}`,
    );

    if (this.environmentService.environment.dryRun) {
      this.logger.debug('Dry run mode enabled - skipping order placement');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.osmiumService.trackEvent({
        name: 'execution_service-limit_order-place-finished',
        metadata: commonTrackingProps,
      });
      return { noOrderId: 'dry-run-no-order-id', yesOrderId: 'dry-run-yes-order-id' };
    }

    // MARK: place orders sequentially
    // 1. Place YES order first
    const yesOrderResponse = await this.clobClient.createAndPostOrder(
      { tokenID: yesTokenId, price: targetYes, side: Side.BUY, size: quantity },
      { tickSize: minimumTickSize },
      OrderType.GTC,
    );

    const yesOrderId = yesOrderResponse.orderID || yesOrderResponse.orderId;
    if (!yesOrderResponse.success || !yesOrderId) {
      this.osmiumService.trackEvent({
        name: 'execution_service-limit_order-place-failed',
        metadata: {
          ...commonTrackingProps,
          failedSide: 'YES',
          reason: yesOrderResponse.errorMsg,
        },
      });
      throw new Error(`Failed to place YES order: ${yesOrderResponse.errorMsg ?? 'Unknown error'}`);
    }

    // 2. Place NO order only after YES succeeds
    const noOrderResponse = await this.clobClient.createAndPostOrder(
      { tokenID: noTokenId, price: targetNo, side: Side.BUY, size: quantity },
      { tickSize: minimumTickSize },
      OrderType.GTC,
    );

    const noOrderId = noOrderResponse.orderID || noOrderResponse.orderId;
    if (!noOrderResponse.success || !noOrderId) {
      this.osmiumService.trackEvent({
        name: 'execution_service-limit_order-place-failed',
        metadata: {
          ...commonTrackingProps,
          failedSide: 'NO',
          reason: noOrderResponse.errorMsg,
        },
      });
      // Cancel YES order - any fills that occurred will be tracked via WebSocket updates
      this.logger.warn(`NO order failed, cancelling YES order ${yesOrderId}`);
      await this.clobClient.cancelOrder({ orderID: yesOrderId }).catch((err) => {
        this.logger.error(`Failed to cancel YES order ${yesOrderId} during rollback: ${err.message}`);
      });
      throw new Error(`Failed to place NO order: ${noOrderResponse.errorMsg ?? 'Unknown error'}`);
    }

    this.logger.log(`Successfully placed orders: YES=${yesOrderId}, NO=${noOrderId}`);
    this.osmiumService.trackEvent({
      name: 'execution_service-limit_order-place-finished',
      metadata: commonTrackingProps,
    });
    return {
      yesOrderId,
      noOrderId,
    };
  }

  // MARK: place single order
  public async placeSingleOrder(props: {
    conditionId: string;
    side: 'yes' | 'no';
    price: number;
    quantity: number;
  }): Promise<string> {
    const { conditionId, side, price, quantity } = props;

    if (!this.isConfigured || !this.clobClient) {
      throw new Error('CLOB client is not configured');
    }

    const { yesTokenId, noTokenId, minimumTickSize } = this.getMarketMetadata(conditionId);
    const tokenId = side === 'yes' ? yesTokenId : noTokenId;

    this.logger.log(
      `Placing single ${side.toUpperCase()} order on condition ${conditionId}: @ ${price} for quantity ${quantity}`,
    );

    if (this.environmentService.environment.dryRun) {
      this.logger.debug('Dry run mode enabled - skipping single order placement');
      await new Promise((resolve) => setTimeout(resolve, 500));
      return `dry-run-${side}-order-id`;
    }

    const response = await this.clobClient.createAndPostOrder(
      { tokenID: tokenId, price, side: Side.BUY, size: quantity },
      { tickSize: minimumTickSize },
      OrderType.GTC,
    );

    const orderId = response.orderID || response.orderId;
    if (!response.success || !orderId) {
      throw new Error(`Failed to place ${side.toUpperCase()} order: ${response.errorMsg ?? 'Unknown error'}`);
    }

    this.logger.log(`Successfully placed single ${side.toUpperCase()} order: ${orderId}`);
    return orderId;
  }

  // MARK: cancel order
  public async cancelOrder(orderId: string, conditionId?: string) {
    if (!this.clobClient || !this.isConfigured) {
      throw new Error('CLOB client is not configured');
    }

    const trackingProps = { orderId, conditionId, dryRun: this.environmentService.environment.dryRun };

    this.osmiumService.trackEvent({ name: 'execution_service-order-cancel-started', metadata: trackingProps });
    if (this.environmentService.environment.dryRun) {
      this.logger.debug(`Dry run mode enabled - skipping cancellation of order ${orderId}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.osmiumService.trackEvent({ name: 'execution_service-order-cancel-finished', metadata: trackingProps });
      return;
    }

    await this.clobClient.cancelOrder({ orderID: orderId });
    this.osmiumService.trackEvent({ name: 'execution_service-order-cancel-finished', metadata: trackingProps });
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

    const trackingProps: Record<string, unknown> = {
      conditionId,
      yesAmount,
      noAmount,
      dryRun: this.environmentService.environment.dryRun,
    };
    this.osmiumService.trackEvent({ name: 'execution_service-panic_sell-started', metadata: trackingProps });

    if (this.environmentService.environment.dryRun) {
      this.logger.debug('Dry run mode enabled - skipping panic sell');
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.osmiumService.trackEvent({ name: 'execution_service-panic_sell-finished', metadata: trackingProps });
      return;
    }

    if (yesAmount === 0 && noAmount === 0) {
      this.osmiumService.trackEvent({ name: 'execution_service-panic_sell-skipped', metadata: trackingProps });
      return;
    }

    const { yesTokenId, noTokenId, minimumTickSize } = this.getMarketMetadata(conditionId);

    trackingProps['yesTokenId'] = yesTokenId;
    trackingProps['noTokenId'] = noTokenId;
    trackingProps['minimumTickSize'] = minimumTickSize;
    this.osmiumService.trackEvent({ name: 'execution_service-panic_sell-executed', metadata: trackingProps });

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
          .then((res) => this.logSellResult(res, 'YES', conditionId)),
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
          .then((res) => this.logSellResult(res, 'NO', conditionId)),
      );
    }

    await Promise.all(promises);
    this.osmiumService.trackEvent({ name: 'execution_service-panic_sell-finished', metadata: trackingProps });
  }

  // MARK: merge positions
  public mergePositions({ conditionId, amount }: { conditionId: string; amount: number }) {
    return this.relayerService.mergePositions({ conditionId, amount });
  }

  // MARK: redeem positions
  public redeemPositions({ conditionId }: { conditionId: string }) {
    return this.relayerService.redeemPositions({ conditionId });
  }

  // MARK: get order
  public getOrder(orderId: string): Promise<OpenOrder | null> {
    if (!this.clobClient || !this.isConfigured) {
      throw new Error('CLOB client is not configured');
    }

    if (this.environmentService.environment.dryRun) {
      this.logger.debug(`Dry run mode enabled - skipping retrieval of order ${orderId}`);
      return Promise.resolve(null);
    }

    return this.clobClient.getOrder(orderId);
  }

  // #region helper methods
  private logSellResult(
    response: Awaited<ReturnType<typeof ClobClient.prototype.createAndPostOrder>>,
    side: string,
    conditionId: string,
  ) {
    if (response.success) {
      this.logger.log(`Panic Sell ${side} Success: Order ${response.orderID}`);
      this.osmiumService.trackEvent({
        name: 'execution_service-panic_sell-success',
        metadata: { conditionId, side, orderId: response.orderID || response.orderId },
      });
    } else {
      this.logger.error(`Panic Sell ${side} Failed: ${response.errorMsg}`);
      this.osmiumService.trackEvent({
        name: 'execution_service-panic_sell-failed',
        metadata: { conditionId, side, reason: response.errorMsg },
      });
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
