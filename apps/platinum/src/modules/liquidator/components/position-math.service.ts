import { Injectable } from '@nestjs/common';

import { Position } from '../../../types/position';
import { exists } from '../../../utils/exists';
import { validateConditionId } from '../../../utils/validation-condition-id';

@Injectable()
export class PositionMathService {
  public partitionForRedeemablePositions(positions: Position[]): [Position[], Position[]] {
    return positions.reduce<[Position[], Position[]]>(
      (acc, position) => {
        (position.redeemable ? acc[0] : acc[1]).push(position);
        return acc;
      },
      [[], []],
    );
  }

  public getRedeemableConditionIds(positions: Position[]): `0x${string}`[] {
    return positions.reduce<`0x${string}`[]>((acc, position) => {
      if (validateConditionId(position.conditionId)) {
        acc.push(position.conditionId);
      }
      return acc;
    }, []);
  }

  public getPositionCompliments(positions: Position[]): [Position, Position][] {
    const assetToPositionMap = positions.reduce((acc, position) => {
      acc.set(position.asset, position);
      return acc;
    }, new Map<string, Position>());

    return positions.reduce<[Position, Position][]>((acc, position) => {
      const complimentAsset = assetToPositionMap.get(position.oppositeAsset);
      if (complimentAsset) {
        acc.push([position, complimentAsset]);
        // prevent duplicates by removing both positions from the map
        assetToPositionMap.delete(position.asset);
        assetToPositionMap.delete(position.oppositeAsset);
      }
      return acc;
    }, []);
  }

  public getMergeData(
    compliments: [Position, Position][],
    minimumMergeAmount = 0.01,
  ): { conditionId: `0x${string}`; amount: number }[] {
    return compliments
      .map(([posA, posB]) => {
        const amount = Math.min(posA.size, posB.size);
        if (amount < minimumMergeAmount) {
          return null;
        }

        const conditionId = posA.conditionId;
        if (!validateConditionId(conditionId)) {
          return null;
        }

        return { conditionId, amount };
      })
      .filter(exists);
  }
}
