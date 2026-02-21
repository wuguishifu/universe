import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { filter, map, Subscription } from 'rxjs';

import { MarketWsService } from '../clob-ws/market-ws.service';
import { AlphaService, EntryPlan } from './components/alpha.service';

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  private readonly subscriptions: Subscription[] = [];

  private reconcileInterval: NodeJS.Timeout | null = null;
  private debugClearStrategiesInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly alphaService: AlphaService,
  ) {}

  public onModuleInit() {
    // entry pipe
    const marketTickSub = this.marketWsService.marketTicks$
      // MARK: market filtering
      .pipe(
        map((tick) => this.alphaService.analyzeTick(tick)),
        filter((plan): plan is EntryPlan => plan !== null),
      )
      .subscribe((plan) => this.execute(plan));
    this.subscriptions.push(marketTickSub);
  }

  onModuleDestroy() {
    this.logger.debug('Shutting down strategy service...');

    // Unsubscribe from all RxJS subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.length = 0;

    // Clear periodic reconciliation timer
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    if (this.debugClearStrategiesInterval) {
      clearInterval(this.debugClearStrategiesInterval);
      this.debugClearStrategiesInterval = null;
    }
  }

  private async execute(plan: EntryPlan) {
    // TODO: execute the plan using the execution service
  }
}
