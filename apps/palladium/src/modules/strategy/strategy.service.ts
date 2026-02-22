import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { filter, map, Subscription } from 'rxjs';

import { OsmiumService } from '@wuguishifu/nest-common';

import { MarketWsService } from '../clob-ws/market-ws.service';
import { ExecutionService } from '../execution/execution.service';
import { LedgerService } from '../ledger/ledger.service';
import { AlphaService, EntryPlan } from './components/alpha.service';

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  private readonly subscriptions: Subscription[] = [];
  private readonly enteredMarkets = new Set<string>();

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly alphaService: AlphaService,
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
    private readonly osmiumService: OsmiumService,
  ) {}

  public onModuleInit() {
    const marketTickSub = this.marketWsService.marketTicks$
      .pipe(
        map((tick) => this.alphaService.analyzeTick(tick)),
        filter((plan): plan is EntryPlan => plan !== null),
      )
      .subscribe((plan) => this.execute(plan));
    this.subscriptions.push(marketTickSub);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down strategy service...');
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.length = 0;
  }

  private async execute(plan: EntryPlan) {
    if (this.enteredMarkets.has(plan.conditionId)) {
      this.osmiumService.trackDebug({
        name: 'strategy-entry-skipped-duplicate',
        metadata: { conditionId: plan.conditionId, side: plan.side, price: plan.price },
      });
      return;
    }

    const requiredCapital = plan.price * plan.quantity;

    if (!this.ledgerService.hasAvailableCapital(requiredCapital)) {
      this.osmiumService.trackDebug({
        name: 'strategy-entry-skipped-insufficient-capital',
        metadata: {
          conditionId: plan.conditionId,
          requiredCapital,
          availableBalance: this.ledgerService.getAvailableBalance(),
        },
      });
      return;
    }

    this.ledgerService.debit(requiredCapital, 'strategy-execute');

    this.osmiumService.trackEvent({
      name: 'strategy-entry-attempted',
      metadata: {
        ...plan,
        availableBalanceBefore: this.ledgerService.getAvailableBalance() + requiredCapital,
      },
    });

    try {
      await this.executionService.placeSingleOrder({
        conditionId: plan.conditionId,
        side: plan.side.toLowerCase() as 'yes' | 'no',
        price: plan.price,
        quantity: plan.quantity,
      });

      this.enteredMarkets.add(plan.conditionId);
      this.logger.log(`Order placed: ${plan.conditionId} ${plan.side} @ ${plan.price} x${plan.quantity}`);
    } catch (error) {
      this.ledgerService.credit(requiredCapital);
      this.osmiumService.trackEvent({
        name: 'strategy-entry-failed',
        metadata: { conditionId: plan.conditionId, side: plan.side, error: (error as Error).message },
      });
      this.logger.error(`Entry failed for ${plan.conditionId}: ${(error as Error).message}`);
    }
  }
}
