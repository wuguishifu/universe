import { Injectable, Logger } from '@nestjs/common';
import { OpenOrder } from '@polymarket/clob-client';
import debounce from 'lodash.debounce';

import { AlphaService, EntryPlan } from './alpha.service';
import { ActiveStraddle, PositionService } from './position.service';
import { EnvironmentService } from '../../../environment/environment-service';
import { OrderMessage } from '../../../types/clob/orderMessage';
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
    private readonly environmentService: EnvironmentService,
    private readonly alphaService: AlphaService,
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
      });
      this.positionService.setMarketInProgress(conditionId, false);
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${conditionId}: ${(error as Error).message}`);
      this.positionService.setMarketInProgress(conditionId, false);
      this.ledgerService.credit(capital);
    }
  }

  public handleOrderUpdate(update: OrderMessage) {
    const conditionId = this.orderMap.get(update.id);
    if (!conditionId) {
      this.logger.warn(`Received order update for unknown orderId: ${update.id}`);
      return;
    }

    const straddle = this.positionService.getStraddle(conditionId);
    if (!straddle) {
      this.logger.warn(`No active straddle found for conditionId: ${conditionId}`);
      return;
    }

    const isYes = update.id === straddle.yesOrderId;
    const legPrefix = isYes ? 'yes' : 'no';

    const newMatched = parseFloat(update.size_matched);
    const delta = newMatched - straddle[`${legPrefix}CumulativeFilled`];

    straddle[`${legPrefix}CumulativeFilled`] = newMatched;
    if (delta > 0) {
      straddle[`${legPrefix}Holdings`] += delta;
    }

    const originalSize = parseFloat(update.original_size);
    if (update.type === 'CANCELLATION') {
      straddle[`${legPrefix}Status`] = 'CANCELED';
      const unfilled = straddle.quantity - newMatched;
      if (unfilled > 0) {
        this.ledgerService.credit(straddle[`${legPrefix}Price`] * unfilled);
      }
    } else if (newMatched >= originalSize) {
      straddle[`${legPrefix}Status`] = 'FILLED';
    }

    // Trigger Side Effects
    this.attemptMerge(straddle);
    this.checkCompletion(straddle);
  }

  private checkCompletion(straddle: ActiveStraddle) {
    if (this.isStraddleComplete(straddle)) {
      this.logger.debug(`Straddle on condition ${straddle.conditionId} is complete. Cleaning up state.`);
      this.cleanupStraddle(straddle);
    }
  }

  public attemptMerge = debounce(async (straddle: ActiveStraddle) => {
    if (straddle.mergeInProgress) {
      return;
    }

    const match = Math.min(straddle.yesHoldings, straddle.noHoldings);
    if (match <= 0) {
      return;
    }

    straddle.mergeInProgress = true;
    straddle.yesHoldings -= match;
    straddle.noHoldings -= match;

    this.logger.log(`Merging ${match} positions on condition ${straddle.conditionId}`);
    try {
      await this.executionService.mergePositions({ conditionId: straddle.conditionId, amount: match });
      this.ledgerService.credit(match * 1.0);
    } catch (error) {
      this.logger.error(`Failed to merge positions on ${straddle.conditionId}: ${(error as Error).message}`);
      straddle.yesHoldings += match;
      straddle.noHoldings += match;
    } finally {
      straddle.mergeInProgress = false;
    }
    this.checkCompletion(straddle);
  }, this.environmentService.environment.mergeDebounceMs);

  private cleanupStraddle(straddle: ActiveStraddle) {
    this.positionService.removeStraddle(straddle.conditionId);
    this.orderMap.delete(straddle.yesOrderId);
    this.orderMap.delete(straddle.noOrderId);
    this.alphaService.deleteCondition(straddle.conditionId);
  }

  public async reconcileStraddles() {
    const activeStraddles = this.positionService.getStraddles();
    if (activeStraddles.length === 0) {
      return;
    }

    this.logger.debug(`Reconciling ${activeStraddles.length} active straddle(s)...`);
    const staleStraddles: ActiveStraddle[] = [];
    await Promise.all(
      this.positionService.getStraddles().map(async (straddle) => {
        const hasChanged = await this.reconcileSingleStraddle(straddle);
        if (hasChanged) {
          this.attemptMerge(straddle);
          if (this.isStraddleComplete(straddle)) {
            staleStraddles.push(straddle);
          }
        }
      }),
    );

    staleStraddles.forEach((straddle) => {
      this.logger.debug(`Cleaning up stale straddle on ${straddle.conditionId} (both legs terminal, holdings ~0)`);
      this.cleanupStraddle(straddle);
    });

    if (this.environmentService.environment.reconcileLedgerSync) {
      await this.syncLedgerWithReality();
    }
  }

  private async reconcileSingleStraddle(straddle: ActiveStraddle): Promise<boolean> {
    const [yesOrder, noOrder] = await Promise.all([
      this.executionService.getOrder(straddle.yesOrderId).catch(() => null),
      this.executionService.getOrder(straddle.noOrderId).catch(() => null),
    ]);

    const yesChanged = this.reconcileLeg(straddle, 'yes', yesOrder);
    const noChanged = this.reconcileLeg(straddle, 'no', noOrder);
    return yesChanged || noChanged;
  }

  private reconcileLeg(straddle: ActiveStraddle, side: 'yes' | 'no', apiOrder: OpenOrder | null): boolean {
    if (!apiOrder) {
      return false;
    }

    const filledKey = `${side}CumulativeFilled` as const;
    const holdingsKey = `${side}Holdings` as const;
    const statusKey = `${side}Status` as const;
    const priceKey = `${side}Price` as const;

    const apiMatched = parseFloat(apiOrder.size_matched);
    const delta = apiMatched - straddle[filledKey];

    if (delta > 0) {
      this.logger.debug(
        `Reconcile drift: ${side.toUpperCase()} on ${straddle.conditionId} missed ${delta.toFixed(6)} fills`,
      );
      straddle[filledKey] = apiMatched;
      straddle[holdingsKey] += delta;
    }

    if (apiOrder.status === 'MATCHED') {
      straddle[statusKey] = 'FILLED';
    } else if (apiOrder.status === 'CANCELED') {
      if (straddle[statusKey] !== 'CANCELED') {
        const unfilledQty = straddle.quantity - straddle[filledKey];
        if (unfilledQty > 0) {
          const refund = straddle[priceKey] * unfilledQty;
          this.logger.warn(`Refunding missed cancel on ${straddle.conditionId}: ${refund.toFixed(4)}`);
          this.ledgerService.credit(refund);
        }
      }
      straddle[statusKey] = 'CANCELED';
    }

    return delta > 0;
  }

  private isStraddleComplete(s: ActiveStraddle): boolean {
    const yesDone = s.yesStatus === 'FILLED' || s.yesStatus === 'CANCELED';
    const noDone = s.noStatus === 'FILLED' || s.noStatus === 'CANCELED';
    const empty = s.yesHoldings < 0.001 && s.noHoldings < 0.001;
    return yesDone && noDone && empty;
  }

  private async syncLedgerWithReality() {
    try {
      const walletBalance = await this.ledgerService.getUserBalance();
      const lockedCapital = this.calculateLockedCapital();
      const expectedAvailable = walletBalance - lockedCapital;
      const ghostBalance = this.ledgerService.getAvailableBalance();
      const drift = Math.abs(expectedAvailable - ghostBalance);

      if (drift > 0.01) {
        this.logger.warn(`Ledger drift detected: ${drift.toFixed(4)}. Syncing.`);
        await this.ledgerService.sync(lockedCapital);
      }
    } catch (error) {
      this.logger.error(`Failed to sync ledger: ${(error as Error).message}`);
    }
  }

  private calculateLockedCapital(excludeConditionId?: string): number {
    let locked = 0;
    for (const s of this.positionService.getStraddles()) {
      if (s.conditionId === excludeConditionId) {
        continue;
      }

      // Unfilled portions of OPEN orders (locked by the exchange)
      if (s.yesStatus === 'OPEN') {
        locked += s.yesPrice * (s.quantity - s.yesCumulativeFilled);
      }
      if (s.noStatus === 'OPEN') {
        locked += s.noPrice * (s.quantity - s.noCumulativeFilled);
      }

      // Unmerged shares (capital that left the wallet as fills)
      locked += s.yesPrice * s.yesHoldings;
      locked += s.noPrice * s.noHoldings;
    }
    return locked;
  }

  public async destroy() {
    if (this.positionService.straddleCount === 0) {
      this.logger.debug('  No active straddles to clean up');
      return;
    }

    this.logger.debug(`  Cleaning up ${this.positionService.straddleCount} active straddles...`);

    await this.cancelAllOpenOrders();
    this.logger.debug('  All open orders cancelled.');

    await this.sellAllExcessHoldings();
    this.logger.debug('  Excess holdings sold.');
    this.logger.debug('Shutdown complete.');
  }

  private async cancelAllOpenOrders() {
    await Promise.all(
      this.positionService.getStraddles().flatMap((straddle) => {
        const promises: Promise<void>[] = [];
        if (straddle.yesStatus === 'OPEN') {
          promises.push(
            this.executionService.cancelOrder(straddle.yesOrderId).catch((err) => {
              this.logger.error(`Failed to cancel YES order ${straddle.yesOrderId}: ${(err as Error).message}`);
            }),
          );
        }
        if (straddle.noStatus === 'OPEN') {
          promises.push(
            this.executionService.cancelOrder(straddle.noOrderId).catch((err) => {
              this.logger.error(`Failed to cancel NO order ${straddle.noOrderId}: ${(err as Error).message}`);
            }),
          );
        }
        return promises;
      }),
    );
  }

  private async sellAllExcessHoldings() {
    await Promise.all(
      this.positionService.getStraddles().map((straddle) => {
        const excessYes = Math.max(0, straddle.yesHoldings - straddle.noHoldings);
        const excessNo = Math.max(0, straddle.noHoldings - straddle.yesHoldings);

        if (excessYes > 0 || excessNo > 0) {
          this.logger.debug(
            `Selling excess on ${straddle.conditionId}: YES=${excessYes.toFixed(2)}, NO=${excessNo.toFixed(2)}`,
          );

          try {
            return this.executionService.sellMarketPosition({
              conditionId: straddle.conditionId,
              yesAmount: excessYes,
              noAmount: excessNo,
            });
          } catch (err) {
            this.logger.error(`Failed to sell excess on ${straddle.conditionId}: ${(err as Error).message}`);
          }
        }
      }),
    );
  }
}
