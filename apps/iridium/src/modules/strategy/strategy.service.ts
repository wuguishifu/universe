import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { filter, map, Subscription } from 'rxjs';

import { AlphaService, EntryPlan } from './components/alpha.service';
import { PositionService } from './components/position.service';
import { StraddleManagerService } from './components/straddle-manager.service';
import { EnvironmentService } from '../../environment/environment-service';
import { MarketWsService } from '../clob/ws/market-ws.service';
import { UserWsService } from '../clob/ws/user-ws.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  /** RxJS subscriptions to clean up on destroy */
  private readonly subscriptions: Subscription[] = [];

  /** Periodic reconciliation timer */
  private reconcileInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly userWsService: UserWsService,
    private readonly marketWsService: MarketWsService,
    private readonly environmentService: EnvironmentService,
    private readonly ledgerService: LedgerService,
    private readonly alphaService: AlphaService,
    private readonly positionService: PositionService,
    private readonly straddleManagerService: StraddleManagerService,
  ) {}

  public onModuleInit() {
    // entry pipe
    const marketTickSub = this.marketWsService.marketTicks$
      // MARK: market filtering
      .pipe(
        filter((tick) => !this.positionService.isMarketInProgress(tick.conditionId)),
        map((tick) => this.alphaService.analyzeTick(tick)),
        filter((plan): plan is EntryPlan => plan !== null),
      )
      .subscribe((plan) => this.execute(plan));
    this.subscriptions.push(marketTickSub);

    // lifecycle pipe
    const orderUpdateSub = this.userWsService.orderUpdates$.subscribe((update) =>
      this.straddleManagerService.handleOrderUpdate(update),
    );
    this.subscriptions.push(orderUpdateSub);

    // reconciliation pipe — catch up on fills missed during WebSocket disconnects
    const reconnectSub = this.userWsService.reconnected$.subscribe(() =>
      this.straddleManagerService.reconcileStraddles(),
    );
    this.subscriptions.push(reconnectSub);

    // periodic reconciliation — catch any drift on a configurable interval
    const reconcileMs = this.environmentService.environment.reconcileIntervalMs;
    this.logger.debug(`Periodic reconciliation interval: ${reconcileMs}ms`);
    this.reconcileInterval = setInterval(() => this.straddleManagerService.reconcileStraddles(), reconcileMs);
  }

  async onModuleDestroy() {
    this.logger.debug('Shutting down strategy service...');

    // Unsubscribe from all RxJS subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.length = 0;

    // Clear periodic reconciliation timer
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    await this.straddleManagerService.destroy();
  }

  private async execute(plan: EntryPlan) {
    const requiredCapital = (plan.targetYes + plan.targetNo) * plan.quantity;
    if (!this.ledgerService.hasAvailableCapital(requiredCapital)) {
      return;
    }
    this.logger.log(
      `Placing straddle for ${plan.conditionId} with targets YES=${plan.targetYes}, NO=${plan.targetNo}, quantity=${plan.quantity} (capital: ${requiredCapital.toFixed(4)}). Reason: ${plan.reason}`,
    );

    this.positionService.setMarketInProgress(plan.conditionId);
    await this.straddleManagerService.placeStraddle(plan);
    this.positionService.setMarketInProgress(plan.conditionId, false);
  }
}
