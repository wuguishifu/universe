import { Injectable, Logger } from '@nestjs/common';
import { OpenOrder } from '@polymarket/clob-client';
import { Subject } from 'rxjs';

import { OsmiumService } from '@wuguishifu/nest-common';

import { AlphaService, EntryPlan } from './alpha.service';
import { OrderMessage } from '../../../types/clob/orderMessage';
import { ExecutionService } from '../../execution/execution.service';
import { LedgerService } from '../../ledger/ledger.service';
import { ActiveStraddle, PositionService } from '../../position/position.service';

@Injectable()
export class StraddleManagerService {
  private readonly logger = new Logger(StraddleManagerService.name);

  private readonly orderMap = new Map<string, string>();

  private readonly fillProcessedSubject = new Subject<{
    straddle: ActiveStraddle;
  }>();
  public readonly fillProcessed$ = this.fillProcessedSubject.asObservable();

  constructor(
    private readonly positionService: PositionService,
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
    private readonly alphaService: AlphaService,
    private readonly osmiumService: OsmiumService,
  ) {}

  public async placeStraddle(plan: EntryPlan) {
    const { conditionId, targetYes, targetNo, quantity } = plan;
    const capital = (targetYes + targetNo) * quantity;

    try {
      this.ledgerService.debit(capital, 'StraddleManagerService.placeStraddle');
    } catch (error) {
      this.logger.error(`Failed to debit ledger for straddle on ${conditionId}: ${(error as Error).message}`);
      this.osmiumService.trackEvent({
        name: 'straddle-place-failed',
        metadata: { conditionId, reason: (error as Error).message },
      });
      return;
    }

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
        skewInProgress: false,
      });
      this.osmiumService.trackEvent({
        name: 'straddle-placed',
        metadata: { conditionId, yesOrderId, noOrderId, yesPrice: targetYes, noPrice: targetNo, quantity, capital },
      });
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${conditionId}: ${(error as Error).message}`);
      this.ledgerService.credit(capital);
      this.osmiumService.trackEvent({
        name: 'straddle-place-failed',
        metadata: { conditionId, reason: (error as Error).message },
      });
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
      const otherSide = isYes ? 'no' : 'yes';
      this.osmiumService.trackEvent({
        name: 'straddle-fill',
        metadata: {
          conditionId,
          side: legPrefix,
          delta,
          cumulativeFilled: newMatched,
          holdings: straddle[`${legPrefix}Holdings`],
          price: straddle[`${legPrefix}Price`],
          otherSideFilled: straddle[`${otherSide}CumulativeFilled`],
          otherSideHoldings: straddle[`${otherSide}Holdings`],
          otherSideStatus: straddle[`${otherSide}Status`],
          yesStatus: straddle.yesStatus,
          noStatus: straddle.noStatus,
          quantity: straddle.quantity,
        },
      });
      this.fillProcessedSubject.next({ straddle });
    }

    const originalSize = parseFloat(update.original_size);
    if (update.type === 'CANCELLATION') {
      straddle[`${legPrefix}Status`] = 'CANCELED';
      const unfilled = originalSize - newMatched;
      if (unfilled > 0) {
        this.ledgerService.credit(straddle[`${legPrefix}Price`] * unfilled);
      }
    } else if (newMatched >= originalSize) {
      straddle[`${legPrefix}Status`] = 'FILLED';
    }

    if (this.isStraddleComplete(straddle)) {
      this.logger.debug(`Straddle on condition ${straddle.conditionId} is complete. Cleaning up state.`);
      this.cleanupStraddle(straddle);
    }
  }

  public updateOrderMapping(oldOrderId: string, newOrderId: string, conditionId: string) {
    this.orderMap.delete(oldOrderId);
    this.orderMap.set(newOrderId, conditionId);
  }

  public cleanupStraddle(straddle: ActiveStraddle) {
    this.osmiumService.trackEvent({
      name: 'straddle-complete',
      metadata: {
        conditionId: straddle.conditionId,
        yesStatus: straddle.yesStatus,
        noStatus: straddle.noStatus,
        yesPrice: straddle.yesPrice,
        noPrice: straddle.noPrice,
        quantity: straddle.quantity,
        yesCumulativeFilled: straddle.yesCumulativeFilled,
        noCumulativeFilled: straddle.noCumulativeFilled,
        yesHoldings: straddle.yesHoldings,
        noHoldings: straddle.noHoldings,
        totalCost: straddle.yesPrice + straddle.noPrice,
      },
    });
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
      activeStraddles.map(async (straddle) => {
        const hasChanged = await this.reconcileSingleStraddle(straddle);
        if (hasChanged) {
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
      this.osmiumService.trackEvent({
        name: 'straddle-reconcile-drift',
        metadata: {
          conditionId: straddle.conditionId,
          side,
          delta,
          newCumulativeFilled: apiMatched,
          holdings: straddle[holdingsKey],
        },
      });
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
            this.executionService.cancelOrder(straddle.yesOrderId, straddle.conditionId).catch((err) => {
              this.logger.error(`Failed to cancel YES order ${straddle.yesOrderId}: ${(err as Error).message}`);
            }),
          );
        }
        if (straddle.noStatus === 'OPEN') {
          promises.push(
            this.executionService.cancelOrder(straddle.noOrderId, straddle.conditionId).catch((err) => {
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

  public clearAllStraddles() {
    this.logger.debug('Debug: Clearing all straddles...');
    this.positionService.getStraddles().forEach((straddle) => this.cleanupStraddle(straddle));
  }
}
