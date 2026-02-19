import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { filter, map, Subscription } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { MarketWsService } from '../clob/ws/market-ws.service';
import { UserWsService } from '../clob/ws/user-ws.service';
import { LedgerService } from '../ledger/ledger.service';
import { MarketAdapterService } from '../market-adapter/market-adapter.service';
import { PositionService } from '../position/position.service';
import { AlphaService, EntryPlan } from './components/alpha.service';
import { InventorySkewService } from './components/inventory-skew.service';
import { StraddleManagerService } from './components/straddle-manager.service';

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  private readonly subscriptions: Subscription[] = [];

  private reconcileInterval: NodeJS.Timeout | null = null;
  private debugClearStrategiesInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly userWsService: UserWsService,
    private readonly marketWsService: MarketWsService,
    private readonly environmentService: EnvironmentService,
    private readonly ledgerService: LedgerService,
    private readonly alphaService: AlphaService,
    private readonly positionService: PositionService,
    private readonly straddleManagerService: StraddleManagerService,
    private readonly inventorySkewService: InventorySkewService,
    private readonly marketAdapterService: MarketAdapterService,
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

    // trade events pipe — feed trade data to alpha service for toxic flow detection
    const tradeEventSub = this.marketWsService.tradeEvents$.subscribe((event) => this.alphaService.recordTrade(event));
    this.subscriptions.push(tradeEventSub);

    // lifecycle pipe
    const orderUpdateSub = this.userWsService.orderUpdates$.subscribe((update) =>
      this.straddleManagerService.handleOrderUpdate(update),
    );
    this.subscriptions.push(orderUpdateSub);

    // inventory skew pipe — react to fills by adjusting order prices
    const skewSub = this.straddleManagerService.fillProcessed$.subscribe(({ straddle }) =>
      this.inventorySkewService.onFill(straddle),
    );
    this.subscriptions.push(skewSub);

    // reconciliation pipe — catch up on fills missed during WebSocket disconnects
    const reconnectSub = this.userWsService.reconnected$.subscribe(() =>
      this.straddleManagerService.reconcileStraddles(),
    );
    this.subscriptions.push(reconnectSub);

    // periodic reconciliation — catch any drift on a configurable interval
    const reconcileMs = this.environmentService.environment.reconcileIntervalMs;
    this.logger.debug(`Periodic reconciliation interval: ${reconcileMs}ms`);
    this.reconcileInterval = setInterval(() => this.straddleManagerService.reconcileStraddles(), reconcileMs);

    if (this.environmentService.environment.debugClearStraddles) {
      this.logger.warn('Debug mode: Clearing all straddles every 10 seconds');
      this.debugClearStrategiesInterval = setInterval(() => {
        this.straddleManagerService.clearAllStraddles();
      }, 10_000);
    }
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

    if (this.debugClearStrategiesInterval) {
      clearInterval(this.debugClearStrategiesInterval);
      this.debugClearStrategiesInterval = null;
    }

    await this.straddleManagerService.destroy();
  }

  private async execute(plan: EntryPlan) {
    const straddleCooldownMs =
      this.environmentService.environment.straddleCooldownMsOverride ??
      this.marketAdapterService.adapter.straddleCooldownMs;
    if (!this.straddleManagerService.canPlace(plan.conditionId, straddleCooldownMs)) {
      return;
    }

    const requiredCapital = (plan.targetYes + plan.targetNo) * plan.quantity;
    if (!this.ledgerService.hasAvailableCapital(requiredCapital)) {
      return;
    }
    this.logger.log(
      `Placing straddle for ${plan.conditionId} with targets YES=${plan.targetYes}, NO=${plan.targetNo}, quantity=${plan.quantity} (capital: ${requiredCapital.toFixed(4)}). Reason: ${plan.reason}`,
    );

    const stopLossConfig = {
      timeoutMs:
        this.environmentService.environment.stopLossTimeoutMsOverride ??
        this.marketAdapterService.adapter.stopLossTimeoutMs,
      maxDropCents:
        this.environmentService.environment.stopLossMaxDropCents ??
        this.marketAdapterService.adapter.stopLossMaxDropCents,
      gracePeriodMs:
        this.environmentService.environment.stopLossGracePeriodMs ??
        this.marketAdapterService.adapter.stopLossGracePeriodMs,
      minTimeRemainingMs:
        this.environmentService.environment.stopLossMinTimeRemainingMs ??
        this.marketAdapterService.adapter.stopLossMinTimeRemainingMs,
      confirmationDelayMs:
        this.environmentService.environment.stopLossConfirmationDelayMs ??
        this.marketAdapterService.adapter.stopLossConfirmationDelayMs,
      confirmationFastVelocityThreshold:
        this.environmentService.environment.stopLossConfirmationFastVelocityThreshold ??
        this.marketAdapterService.adapter.stopLossConfirmationFastVelocityThreshold,
    };

    this.positionService.setMarketInProgress(plan.conditionId, true);
    await this.straddleManagerService.placeStraddle(plan, stopLossConfig);
    this.positionService.setMarketInProgress(plan.conditionId, false);
  }
}
