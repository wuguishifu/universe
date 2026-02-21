import { Injectable, Logger } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';
import { BINARY_PARTITION, EMPTY_COLLECTION_ID, USDC_ADDRESS } from '@wuguishifu/utils-polymarket';

import { EnvironmentService } from '../../environment/environment-service';
import { DataService } from '../data/data.service';
import { RelayerService } from '../relayer/relayer.service';
import { ConditionalTokensService } from './components/conditional-tokens.service';
import { PositionMathService } from './components/position-math.service';

@Injectable()
export class LiquidatorService {
  private readonly logger = new Logger(LiquidatorService.name);

  constructor(
    private readonly dataService: DataService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly relayerService: RelayerService,
    private readonly conditionalTokensService: ConditionalTokensService,
    private readonly positionMathService: PositionMathService,
  ) {}

  public async liquidate() {
    const positions = await this.dataService.getUserPositions();
    if (!positions.length) {
      this.logger.debug('No positions found, skipping liquidation cycle');
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'liquidation-skipped',
          metadata: { reason: 'no_positions' },
        });
      }
      return;
    }

    if (!positions.some((position) => position.mergeable || position.redeemable)) {
      this.logger.debug('No liquidatable positions found, skipping liquidation cycle');
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'liquidation-skipped',
          metadata: { reason: 'no_liquidatable_positions' },
        });
      }
      return;
    }

    const [redeemablePositions, rest] = this.positionMathService.partitionForRedeemablePositions(positions);
    const redeemableConditionIds = this.positionMathService.getRedeemableConditionIds(redeemablePositions);
    const encodedRedeemTransactions = redeemableConditionIds.map((conditionId) =>
      this.conditionalTokensService.encodeRedeemPositions({
        collateralToken: USDC_ADDRESS,
        parentCollectionId: EMPTY_COLLECTION_ID,
        conditionId,
        indexSets: BINARY_PARTITION,
      }),
    );

    const complements = this.positionMathService.getPositionCompliments(rest);
    const mergeData = this.positionMathService.getMergeData(complements);
    const encodedMergeTransactions = mergeData.map(({ conditionId, amount }) =>
      this.conditionalTokensService.encodeMergePositions({
        collateralToken: USDC_ADDRESS,
        parentCollectionId: EMPTY_COLLECTION_ID,
        conditionId,
        partition: BINARY_PARTITION,
        amount,
      }),
    );

    const encodedTransactions = [...encodedRedeemTransactions, ...encodedMergeTransactions];
    try {
      const transaction = await this.relayerService.executeRelayerTx('liquidation', encodedTransactions, {
        redeemCount: encodedRedeemTransactions.length,
        mergeCount: encodedMergeTransactions.length,
      });

      this.logger.log(`Liquidation transaction submitted: ${transaction.transactionID}`);
      this.osmiumService.trackEvent({
        name: 'liquidation_submitted',
        metadata: {
          ...(this.environmentService.environment.enableVerboseEvents
            ? { transaction }
            : { transactionId: transaction.transactionID, transactionHash: transaction.transactionHash }),
          redeemCount: encodedRedeemTransactions.length,
          mergeCount: encodedMergeTransactions.length,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Liquidation error: ${errorMessage}`);
      this.osmiumService.trackEvent({
        name: 'liquidation_error',
        metadata: { error: errorMessage },
      });
    }
  }
}
