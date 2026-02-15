import { Injectable } from '@nestjs/common';
import { encodeFunctionData, parseUnits } from 'viem';

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

@Injectable()
export class ConditionalTokensService {
  public encodeRedeemPositions({
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  }: {
    collateralToken: `0x${string}`;
    parentCollectionId: `0x${string}`;
    conditionId: `0x${string}`;
    indexSets: bigint[];
  }): `0x${string}` {
    return encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'redeemPositions',
      args: [collateralToken, parentCollectionId, conditionId, indexSets],
    });
  }

  public encodeMergePositions({
    collateralToken,
    parentCollectionId,
    conditionId,
    partition,
    amount,
    decimals = 6, // Defaults to 6 for USDC, but allows overrides for WETH (18)}
  }: {
    collateralToken: `0x${string}`;
    parentCollectionId: `0x${string}`;
    conditionId: `0x${string}`;
    partition: bigint[];
    amount: number;
    decimals?: number;
  }): `0x${string}` {
    const rawAmount = parseUnits(amount.toFixed(decimals), decimals);

    return encodeFunctionData({
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: 'mergePositions',
      args: [collateralToken, parentCollectionId, conditionId, partition, rawAmount],
    });
  }

  /**
   * Validates if a string is a properly formatted bytes32 condition ID.
   */
  public isValidConditionId(conditionId: string): conditionId is `0x${string}` {
    return /^0x[0-9a-fA-F]{64}$/.test(conditionId);
  }
}
