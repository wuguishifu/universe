import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { encodeFunctionData, parseUnits } from 'viem';

import { OsmiumService } from '@wuguishifu/nest-common';

import {
  CONDITIONAL_TOKENS_ADDRESS,
  POLYGON_CHAIN_ID,
  POLYGON_RPC_URL,
  RELAYER_API_BASE,
  USDC_ADDRESS,
} from '../../constants/constants';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class RelayerService implements OnModuleInit {
  private readonly logger = new Logger(RelayerService.name);

  private client: RelayClient | null = null;
  private signer: Wallet | null = null;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  public onModuleInit() {
    this.logger.debug('Initializing Relayer Client');

    const { privateKey, polyApiKey, polyApiSecret, polyApiPassphrase } = this.environmentService.environment;
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

    // The RelayClient requires a signer with a provider attached
    const provider = new JsonRpcProvider(POLYGON_RPC_URL);
    this.signer = new Wallet(formattedKey, provider);

    const builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: polyApiKey,
        secret: polyApiSecret,
        passphrase: polyApiPassphrase,
      },
    });

    this.client = new RelayClient(RELAYER_API_BASE, POLYGON_CHAIN_ID, this.signer, builderConfig, RelayerTxType.PROXY);
    this.logger.debug(`Relayer initialized for wallet: ${this.signer.address} (PROXY mode)`);
  }

  public async mergePositions({ conditionId, amount }: { conditionId: string; amount: number }): Promise<string> {
    if (!this.client) {
      throw new Error('Relayer client not initialized');
    }

    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    this.logger.log(`Merging positions for condition ${conditionId} with amount ${amount}`);
    const commonTrackingProperties = { conditionId, amount, dryRun: this.environmentService.environment.dryRun };
    this.osmiumService.trackEvent({
      name: 'relayer_service-merge_positions-started',
      metadata: commonTrackingProperties,
    });

    if (this.environmentService.environment.dryRun) {
      this.logger.debug('Dry run mode enabled - skipping merge positions');
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.osmiumService.trackEvent({
        name: 'relayer_service-merge_positions-finished',
        metadata: commonTrackingProperties,
      });
      return 'dry-run-merge-positions-tx-id';
    }

    // encode transaction data
    const rawAmount = parseUnits(amount.toFixed(6), 6);
    const data = encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'mergePositions',
      args: [
        USDC_ADDRESS,
        '0x0000000000000000000000000000000000000000000000000000000000000000', // parent collectionId (always empty for binary markets)
        conditionId,
        [1n, 2n], // partition set [1, 2] = [YES, NO]
        rawAmount,
      ],
    });

    // create transaction object
    const tx = { to: CONDITIONAL_TOKENS_ADDRESS, data, value: '0' };

    try {
      // send to relayer
      const response = await this.client.execute([tx]);
      const result = await response.wait();

      if (result) {
        this.logger.log(`Merge positions transaction submitted: ${result.transactionHash}`);
        this.osmiumService.trackEvent({
          name: 'relayer_service-merge_positions-finished',
          metadata: {
            ...commonTrackingProperties,
            transactionHash: result.transactionHash,
          },
        });
        return result.transactionID;
      }

      // wait() returns undefined when the tx hits STATE_FAILED or polling times out
      const txDetails = await response.getTransaction().catch(() => undefined);
      const failureMetadata = {
        ...commonTrackingProperties,
        relayerTxId: response.transactionID,
        transactionHash: txDetails?.[0]?.transactionHash,
        state: txDetails?.[0]?.state,
      };
      this.logger.error(`Merge positions failed on-chain: ${JSON.stringify(failureMetadata)}`);
      this.osmiumService.trackEvent({
        name: 'relayer_service-merge_positions-failed',
        metadata: failureMetadata,
      });
      throw new Error(`Failed to submit merge positions transaction (txId: ${response.transactionID})`);
    } catch (error) {
      // If already handled above (re-thrown), propagate as-is
      if (error instanceof Error && error.message.startsWith('Failed to submit merge positions')) {
        throw error;
      }

      // Unexpected error from execute() or wait()
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Merge positions unexpected error: ${errorMessage}`);
      this.osmiumService.trackEvent({
        name: 'relayer_service-merge_positions-failed',
        metadata: { ...commonTrackingProperties, error: errorMessage },
      });
      throw new Error(`Merge positions error: ${errorMessage}`);
    }
  }

  public async redeemPositions({ conditionId }: { conditionId: string }): Promise<string> {
    if (!this.client) {
      throw new Error('Relayer client not initialized');
    }

    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    this.logger.log(`Redeeming positions for condition ${conditionId}`);
    const commonTrackingProperties = { conditionId, dryRun: this.environmentService.environment.dryRun };
    this.osmiumService.trackEvent({
      name: 'relayer_service-redeem_positions-started',
      metadata: commonTrackingProperties,
    });

    if (this.environmentService.environment.dryRun) {
      this.logger.debug('Dry run mode enabled - skipping redeem positions');
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.osmiumService.trackEvent({
        name: 'relayer_service-redeem_positions-finished',
        metadata: commonTrackingProperties,
      });
      return 'dry-run-redeem-positions-tx-id';
    }

    const data = encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'redeemPositions',
      args: [USDC_ADDRESS, '0x0000000000000000000000000000000000000000000000000000000000000000', conditionId, [1n, 2n]],
    });

    const tx = { to: CONDITIONAL_TOKENS_ADDRESS, data, value: '0' };

    try {
      const response = await this.client.execute([tx]);
      const result = await response.wait();

      if (result) {
        this.logger.log(`Redeem positions transaction submitted: ${result.transactionHash}`);
        this.osmiumService.trackEvent({
          name: 'relayer_service-redeem_positions-finished',
          metadata: {
            ...commonTrackingProperties,
            transactionHash: result.transactionHash,
          },
        });
        return result.transactionID;
      }

      const txDetails = await response.getTransaction().catch(() => undefined);
      const failureMetadata = {
        ...commonTrackingProperties,
        relayerTxId: response.transactionID,
        transactionHash: txDetails?.[0]?.transactionHash,
        state: txDetails?.[0]?.state,
      };
      this.logger.error(`Redeem positions failed on-chain: ${JSON.stringify(failureMetadata)}`);
      this.osmiumService.trackEvent({
        name: 'relayer_service-redeem_positions-failed',
        metadata: failureMetadata,
      });
      throw new Error(`Failed to submit redeem positions transaction (txId: ${response.transactionID})`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Failed to submit redeem positions')) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Redeem positions unexpected error: ${errorMessage}`);
      this.osmiumService.trackEvent({
        name: 'relayer_service-redeem_positions-failed',
        metadata: { ...commonTrackingProperties, error: errorMessage },
      });
      throw new Error(`Redeem positions error: ${errorMessage}`);
    }
  }

  private validateConditionId(conditionId: string): conditionId is `0x${string}` {
    return conditionId.startsWith('0x');
  }
}

const CONDITIONAL_TOKENS_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'collateralToken', type: 'address' },
      { internalType: 'bytes32', name: 'parentCollectionId', type: 'bytes32' },
      { internalType: 'bytes32', name: 'conditionId', type: 'bytes32' },
      { internalType: 'uint256[]', name: 'partition', type: 'uint256[]' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'mergePositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'collateralToken', type: 'address' },
      { internalType: 'bytes32', name: 'parentCollectionId', type: 'bytes32' },
      { internalType: 'bytes32', name: 'conditionId', type: 'bytes32' },
      { internalType: 'uint256[]', name: 'indexSets', type: 'uint256[]' },
    ],
    name: 'redeemPositions',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
