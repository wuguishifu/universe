import { Injectable, Logger } from '@nestjs/common';

import { EntryPlan } from './alpha.service';
import { PositionService } from './position.service';
import { ExecutionService } from '../../execution/execution.service';
import { LedgerService } from '../../ledger/ledger.service';

@Injectable()
export class StraddleManagerService {
  private readonly logger = new Logger(StraddleManagerService.name);

  private readonly orderMap = new Map<string, string>();

  constructor(
    private readonly positionService: PositionService,
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
  ) {}

  public async placeStraddle(plan: EntryPlan) {
    const { conditionId, targetYes, targetNo, quantity } = plan;
    this.positionService.setMarketInProgress(conditionId);
    const capital = (targetYes + targetNo) * quantity;
    this.ledgerService.debit(capital);

    try {
      const { yesOrderId, noOrderId } = await this.executionService.placeLimitOrder(plan);
      this.orderMap.set(yesOrderId, conditionId);
      this.orderMap.set(noOrderId, conditionId);
      this.positionService.addStraddle({
        conditionId,
        yesOrderId,
        noOrderId,
        yesPrice: targetYes,
        noPrice: targetNo,
        quantity,
        yesHoldings: 0,
        noHoldings: 0,
        yesCumulativeFilled: 0,
        noCumulativeFilled: 0,
        yesStatus: 'OPEN',
        noStatus: 'OPEN',
        mergeInProgress: false,
        isImbalanced: false,
      });
      this.positionService.setMarketInProgress(conditionId, false);
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${conditionId}: ${(error as Error).message}`);
      this.positionService.setMarketInProgress(conditionId, false);
      this.ledgerService.credit(capital);
    }
  }
}
