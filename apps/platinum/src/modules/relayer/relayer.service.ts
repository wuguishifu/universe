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
} from '../../constants';
import { EnvironmentService } from '../../environment/environment-service';

const EMPTY_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';

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
    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    const rawAmount = parseUnits(amount.toFixed(6), 6);
    const data = encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'mergePositions',
      args: [USDC_ADDRESS, EMPTY_COLLECTION_ID, conditionId, [1n, 2n], rawAmount],
    });

    return await this.executeRelayerTx('merge_positions', data, { conditionId, amount });
  }

  public async redeemPositions({ conditionId }: { conditionId: string }): Promise<string> {
    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    const data = encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'redeemPositions',
      args: [USDC_ADDRESS, EMPTY_COLLECTION_ID, conditionId, [1n, 2n]],
    });

    return await this.executeRelayerTx('redeem_positions', data, { conditionId });
  }

  private async executeRelayerTx(
    actionName: string,
    data: `0x${string}`,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Relayer client not initialized');
    }

    this.logger.log(`Executing ${actionName} with metadata: ${JSON.stringify(metadata)}`);
    this.osmiumService.trackEvent({
      name: `relayer_service-${actionName}-started`,
      metadata,
    });

    const tx = { to: CONDITIONAL_TOKENS_ADDRESS, data, value: '0' };

    try {
      const response = await this.client.execute([tx]);
      const result = await response.wait();

      if (result) {
        this.logger.log(`${actionName} transaction submitted: ${result.transactionHash}`);
        this.osmiumService.trackEvent({
          name: `relayer_service-${actionName}-finished`,
          metadata: { ...metadata, transactionHash: result.transactionHash },
        });
        return result.transactionID;
      }

      // wait() returns undefined when the tx hits STATE_FAILED or polling times out
      const txDetails = await response.getTransaction().catch(() => undefined);
      const failureMetadata = {
        ...metadata,
        relayerTxId: response.transactionID,
        transactionHash: txDetails?.[0]?.transactionHash,
        state: txDetails?.[0]?.state,
      };

      this.logger.error(`${actionName} failed on-chain: ${JSON.stringify(failureMetadata)}`);
      this.osmiumService.trackEvent({
        name: `relayer_service-${actionName}-failed`,
        metadata: failureMetadata,
      });
      throw new Error(`Failed to submit ${actionName} transaction (txId: ${response.transactionID})`);
    } catch (error) {
      // If already handled above (re-thrown), propagate as-is
      if (error instanceof Error && error.message.startsWith(`Failed to submit ${actionName}`)) {
        throw error;
      }

      // Unexpected error from execute() or wait()
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`${actionName} unexpected error: ${errorMessage}`);
      this.osmiumService.trackEvent({
        name: `relayer_service-${actionName}-failed`,
        metadata: { ...metadata, error: errorMessage },
      });
      throw new Error(`${actionName} error: ${errorMessage}`);
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
