import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client';

import { CLOB_API_BASE } from '../../constants/constants';
import { EnvironmentService } from '../../environment/environment-service';
import { CacheService } from '../cache/cache.service';

const POLYGON_CHAIN_ID = 137;
const SIGNATURE_TYPE_TO_MODE_DEBUG: Record<number, string> = {
  0: 'Mode: direct EOA wallet',
  1: 'Mode: Polymarket Magic Link proxy wallet',
  2: 'Mode: Polymarket browser wallet (Gnosis Safe proxy)',
};

const TICK_SIZE = '0.01';

@Injectable()
export class ExecutionService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionService.name);

  private isConfigured = false;
  private clobClient: ClobClient | null = null;

  constructor(
    private readonly cacheService: CacheService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Polymarket CLOB client...');
    const { privateKey, funderAddress, signatureType } = this.environmentService.environment;

    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const wallet = new Wallet(formattedKey);

    this.logger.debug(`    Wallet address: ${wallet.address}`);
    this.logger.debug(`    Signature type: ${signatureType}`);
    this.logger.debug(`    Funder address: ${funderAddress || 'N/A (using wallet address)'}`);
    this.logger.debug(`    CLOB API: ${CLOB_API_BASE}`);
    this.logger.debug(`    ${SIGNATURE_TYPE_TO_MODE_DEBUG[signatureType]}`);

    try {
      // initialize client without credentials first
      const tempClient = new ClobClient(
        CLOB_API_BASE,
        POLYGON_CHAIN_ID,
        wallet,
        undefined,
        signatureType,
        funderAddress,
      );

      // derive API credentials
      this.logger.debug('Deriving API credentials...');
      const credentials = await tempClient.createOrDeriveApiKey();
      this.logger.log('API credentials created.');

      // create final client with credentials
      this.clobClient = new ClobClient(
        CLOB_API_BASE,
        POLYGON_CHAIN_ID,
        wallet,
        credentials,
        signatureType,
        funderAddress,
      );
      this.isConfigured = true;
    } catch (error) {
      this.logger.error('Error initializing CLOB client:', error);
    }
  }

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
    if (!this.isConfigured || !this.clobClient) {
      throw new Error('CLOB client is not configured');
    }

    const { yesTokenId, noTokenId } = this.getTokenIds(marketId);
    this.logger.log(
      `Placing limit orders on market ${marketId}: Yes Token @ ${targetYes}, No Token @ ${targetNo} for quantity ${quantity}`,
    );

    const [yesOrderResponse, noOrderResponse] = await Promise.all([
      this.clobClient.createAndPostOrder(
        { tokenID: yesTokenId, price: targetYes, side: Side.BUY, size: quantity },
        { tickSize: TICK_SIZE },
        OrderType.GTC,
      ),
      this.clobClient.createAndPostOrder(
        { tokenID: noTokenId, price: targetNo, side: Side.BUY, size: quantity },
        { tickSize: TICK_SIZE },
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

  public async cancelOrder(orderId: string) {
    if (!this.clobClient || !this.isConfigured) {
      throw new Error('CLOB client is not configured');
    }
    await this.clobClient.cancelOrder({ orderID: orderId });
    this.logger.log(`Cancelled order ${orderId}`);
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
    // const { yesTokenId, noTokenId } = this.getTokenIds(marketId);
    this.getTokenIds(marketId);

    this.logger.log(`Selling market positions on market ${marketId}: Yes Amount: ${yesAmount}, No Amount: ${noAmount}`);
  }

  public async mergePositions({ marketId, amount }: { marketId: string; amount: number }) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    // const { yesTokenId, noTokenId } = this.getTokenIds(marketId);
    this.getTokenIds(marketId);

    this.logger.log(`Merging ${amount} positions on market ${marketId}`);
  }

  private getTokenIds(marketId: string): { yesTokenId: string; noTokenId: string } {
    const market = this.cacheService.markets.get(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found in cache`);
    }

    const { yesToken, noToken } = market;
    if (!yesToken || !noToken) {
      throw new Error(`Tokens for market ${marketId} are not available`);
    }

    return { yesTokenId: yesToken, noTokenId: noToken };
  }
}
