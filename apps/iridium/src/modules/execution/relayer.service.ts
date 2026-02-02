import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RelayClient } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { encodeFunctionData, parseUnits } from 'viem';

import { CTF_EXCHANGE_ADDRESS, POLYGON_CHAIN_ID, RELAYER_API_BASE, USDC_ADDRESS } from '../../constants/constants';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class RelayerService implements OnModuleInit {
  private readonly logger = new Logger(RelayerService.name);

  private client: RelayClient | null = null;
  private signer: Wallet | null = null;

  constructor(private readonly environmentService: EnvironmentService) {}

  onModuleInit() {
    this.logger.log('Initializing Relayer Client');

    const { privateKey, polyApiKey, polyApiSecret, polyApiPassphrase } = this.environmentService.environment;
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.signer = new Wallet(formattedKey);

    const builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: polyApiKey,
        secret: polyApiSecret,
        passphrase: polyApiPassphrase,
      },
    });

    this.client = new RelayClient(RELAYER_API_BASE, POLYGON_CHAIN_ID, this.signer, builderConfig);
    this.logger.log(`Relayer initialized for wallet: ${this.signer.address}`);
  }

  public async mergePositions({ conditionId, amount }: { conditionId: string; amount: number }): Promise<string> {
    if (!this.client) {
      throw new Error('Relayer client not initialized');
    }

    if (!this.validateConditionId(conditionId)) {
      throw new Error('Invalid conditionId format');
    }

    this.logger.log(`Merging positions for condition ${conditionId} with amount ${amount}`);

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
