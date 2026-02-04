import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RelayClient } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { encodeFunctionData, parseUnits } from 'viem';

import {
  CTF_EXCHANGE_ADDRESS,
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
  private safeDeployed = false;
  private deployPromise: Promise<void> | null = null;

  constructor(private readonly environmentService: EnvironmentService) {}

  public async onModuleInit() {
    this.logger.log('Initializing Relayer Client');

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

    this.client = new RelayClient(RELAYER_API_BASE, POLYGON_CHAIN_ID, this.signer, builderConfig);
    this.logger.log(`Relayer initialized for wallet: ${this.signer.address}`);

    // Deploy Safe wallet if not already deployed
    await this.ensureSafeDeployed();
  }

  private ensureSafeDeployed(): Promise<void> {
    if (this.safeDeployed || !this.client) {
      return Promise.resolve();
    }
    return (this.deployPromise ??= this.deploySafe());
  }

  private async deploySafe(): Promise<void> {
    if (!this.client) {
      return;
    }

    if (this.environmentService.environment.dryRun) {
      this.logger.log('Dry run mode enabled - skipping Safe deployment check');
      this.safeDeployed = true;
      return;
    }

    try {
      this.logger.log('Deploying Safe wallet (if not already deployed)...');
      const response = await this.client.deploy();
      const result = await response.wait();

      if (result) {
        this.logger.log(`Safe deployed successfully at address: ${result.proxyAddress}`);
        this.logger.log(`Deployment transaction hash: ${result.transactionHash}`);
      }

      this.safeDeployed = true;
    } catch (error) {
      // If Safe is already deployed, this may throw or succeed silently
      // Either way, we mark it as deployed to continue
      this.logger.warn(`Safe deployment response: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.safeDeployed = true;
    }
  }

  public async mergePositions({ conditionId, amount }: { conditionId: string; amount: number }): Promise<string> {
    if (!this.client) {
      throw new Error('Relayer client not initialized');
    }

    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    // Ensure Safe is deployed before executing transactions
    await this.ensureSafeDeployed();

    this.logger.log(`Merging positions for condition ${conditionId} with amount ${amount}`);

    if (this.environmentService.environment.dryRun) {
      this.logger.log('Dry run mode enabled - skipping merge positions');
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'dry-run-merge-positions-tx-id';
    }

    // encode transaction data
    const rawAmount = parseUnits(amount.toFixed(6), 6);
    const data = encodeFunctionData({
      abi: CTF_EXCHANGE_ABI,
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
    const tx = { to: CTF_EXCHANGE_ADDRESS, data, value: '0' };

    // send to relayer
    const response = await this.client.execute([tx]);

    this.logger.log(`Merge positions transaction submitted: ${response.transactionHash}`);
    return response.transactionID;
  }

  private validateConditionId(conditionId: string): conditionId is `0x${string}` {
    return conditionId.startsWith('0x');
  }
}

const CTF_EXCHANGE_ABI = [
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
] as const;
