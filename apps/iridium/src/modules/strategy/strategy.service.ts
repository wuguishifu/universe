import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { filter, map, Subscription } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { OrderMessage } from '../../types/clob/orderMessage';
import { MarketTick, MarketWsService } from '../clob/ws/market-ws.service';
import { UserWsService } from '../clob/ws/user-ws.service';
import { ExecutionService } from '../execution/execution.service';
import { LedgerService } from '../ledger/ledger.service';
import { AlphaService, EntryPlan } from './components/alpha.service';
import { ActiveStraddle, PositionService } from './components/position.service';
import { StraddleManagerService } from './components/straddle-manager.service';

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  /** orderId -> conditionId */
  private readonly orderMap = new Map<string, string>();

  /** RxJS subscriptions to clean up on destroy */
  private readonly subscriptions: Subscription[] = [];

  /** Periodic reconciliation timer */
  private reconcileInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly userWsService: UserWsService,
    private readonly marketWsService: MarketWsService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
    private readonly ledgerService: LedgerService,
    private readonly alphaService: AlphaService,
    private readonly positionService: PositionService,
    private readonly straddleManagerService: StraddleManagerService,
  ) {}

  // #region: module lifecycle

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

    // legging risk pipe — monitor price for imbalanced straddles
    const riskTickSub = this.marketWsService.marketTicks$
      .pipe(
        filter((tick) => {
          const straddle = this.positionService.getStraddle(tick.conditionId);
          return !!straddle?.isImbalanced;
        }),
      )
      .subscribe((tick) => {
        const straddle = this.positionService.getStraddle(tick.conditionId);
        if (straddle) {
          this.evaluateLeggingRisk(tick, straddle);
        }
      });
    this.subscriptions.push(riskTickSub);

    // lifecycle pipe
    const orderUpdateSub = this.userWsService.orderUpdates$.subscribe((update) => this.handleOrderUpdate(update));
    this.subscriptions.push(orderUpdateSub);

    // reconciliation pipe — catch up on fills missed during WebSocket disconnects
    const reconnectSub = this.userWsService.reconnected$.subscribe(() => this.reconcileStraddles());
    this.subscriptions.push(reconnectSub);

    // periodic reconciliation — catch any drift on a configurable interval
    const reconcileMs = this.environmentService.environment.reconcileIntervalMs;
    this.logger.log(`Periodic reconciliation interval: ${reconcileMs}ms`);
    this.reconcileInterval = setInterval(() => this.reconcileStraddles(), reconcileMs);
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

    if (this.positionService.straddleCount === 0) {
      this.logger.debug('No active straddles to clean up');
      return;
    }

    this.logger.debug(`Cleaning up ${this.positionService.straddleCount} active straddles...`);

    // MARK: cancel open orders
    const cancelPromises: Promise<void>[] = [];
    for (const straddle of this.positionService.getStraddles()) {
      this.clearAllRiskTimers(straddle);

      if (straddle.yesStatus === 'OPEN') {
        cancelPromises.push(
          this.executionService.cancelOrder(straddle.yesOrderId).catch((err) => {
            this.logger.error(`Failed to cancel YES order ${straddle.yesOrderId}: ${(err as Error).message}`);
          }),
        );
      }
      if (straddle.noStatus === 'OPEN') {
        cancelPromises.push(
          this.executionService.cancelOrder(straddle.noOrderId).catch((err) => {
            this.logger.error(`Failed to cancel NO order ${straddle.noOrderId}: ${(err as Error).message}`);
          }),
        );
      }
    }

    await Promise.all(cancelPromises);
    this.logger.debug('All open orders cancelled.');

    // MARK: sell excess holdings
    const sellPromises: Promise<void>[] = [];
    for (const straddle of this.positionService.getStraddles()) {
      const excessYes = Math.max(0, straddle.yesHoldings - straddle.noHoldings);
      const excessNo = Math.max(0, straddle.noHoldings - straddle.yesHoldings);

      if (excessYes > 0 || excessNo > 0) {
        this.logger.debug(
          `Selling excess on ${straddle.conditionId}: YES=${excessYes.toFixed(2)}, NO=${excessNo.toFixed(2)}`,
        );
        sellPromises.push(
          this.executionService
            .sellMarketPosition({
              conditionId: straddle.conditionId,
              yesAmount: excessYes,
              noAmount: excessNo,
            })
            .catch((err) => {
              this.logger.error(`Failed to sell excess on ${straddle.conditionId}: ${(err as Error).message}`);
            }),
        );
      }
    }

    if (sellPromises.length > 0) {
      await Promise.all(sellPromises);
      this.logger.debug('Excess holdings sold.');
    }

    this.logger.debug('Shutdown complete.');
  }

  // #endregion

  private async execute(plan: EntryPlan) {
    const requiredCapital = (plan.targetYes + plan.targetNo) * plan.quantity;
    if (!this.ledgerService.hasAvailableCapital(requiredCapital)) {
      return;
    }

    this.logger.log(
      `Placing straddle for ${plan.conditionId} with targets YES=${plan.targetYes}, NO=${plan.targetNo}, quantity=${plan.quantity} (capital: ${requiredCapital.toFixed(4)}). Reason: ${plan.reason}`,
    );
    await this.straddleManagerService.placeStraddle(plan);
  }

  // MARK: order update
  private handleOrderUpdate(update: OrderMessage) {
    // find context
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

    // update state
    let delta = 0;
    const newMatchedSize = parseFloat(update.size_matched);
    const originalSize = parseFloat(update.original_size);

    if (update.id === straddle.yesOrderId) {
      delta = newMatchedSize - straddle.yesCumulativeFilled;
      straddle.yesCumulativeFilled = newMatchedSize;
      if (delta > 0) {
        straddle.yesHoldings += delta;
      }

      if (update.type === 'CANCELLATION') {
        straddle.yesStatus = 'CANCELED';
        const unfilledQty = straddle.quantity - straddle.yesCumulativeFilled;
        if (unfilledQty > 0) {
          this.ledgerService.credit(straddle.yesPrice * unfilledQty);
        }
      } else if (newMatchedSize >= originalSize) {
        straddle.yesStatus = 'FILLED';
      } else {
        straddle.yesStatus = 'OPEN';
      }
    } else if (update.id === straddle.noOrderId) {
      delta = newMatchedSize - straddle.noCumulativeFilled;
      straddle.noCumulativeFilled = newMatchedSize;
      if (delta > 0) {
        straddle.noHoldings += delta;
      }

      if (update.type === 'CANCELLATION') {
        straddle.noStatus = 'CANCELED';
        const unfilledQty = straddle.quantity - straddle.noCumulativeFilled;
        if (unfilledQty > 0) {
          this.ledgerService.credit(straddle.noPrice * unfilledQty);
        }
      } else if (newMatchedSize >= originalSize) {
        straddle.noStatus = 'FILLED';
      } else {
        straddle.noStatus = 'OPEN';
      }
    }

    // schedule merge (debounced to allow fills to accumulate and settle on-chain)
    this.scheduleMerge(straddle);

    // check for complete exit (after scheduling merge, not awaiting it)
    const isYesDone = straddle.yesStatus === 'FILLED' || straddle.yesStatus === 'CANCELED';
    const isNoDone = straddle.noStatus === 'FILLED' || straddle.noStatus === 'CANCELED';
    if (isYesDone && isNoDone) {
      // ensure we don't delete while pending a merge
      if (straddle.yesHoldings < 0.001 && straddle.noHoldings < 0.001) {
        this.logger.debug(`Straddle on condition ${conditionId} is complete. Cleaning up state.`);
        this.cleanupStraddle(straddle);
        return;
      }
    }

    // evaluate legging risk (imbalance or price drop)
    const imbalance = Math.abs(straddle.yesHoldings - straddle.noHoldings);
    if (imbalance > 0 && !straddle.isImbalanced) {
      this.logger.warn(`Imbalance detected for ${conditionId}. Starting absolute safety timer.`);
      straddle.isImbalanced = true;
      straddle.absoluteTimer = setTimeout(
        () => this.panicExit(straddle),
        this.environmentService.environment.panicAbsoluteTimeoutMs,
      );
    } else if (imbalance === 0 && straddle.isImbalanced) {
      this.logger.debug(`Imbalance resolved for ${conditionId}. Clearing all risk timers.`);
      straddle.isImbalanced = false;
      this.clearAllRiskTimers(straddle);
    }
  }
  // #endregion

  // #region merging
  /**
   * Debounces merge attempts so rapid fills accumulate before we send a single
   * on-chain transaction. The 5-second window also gives Polygon time to settle
   * the CLOB fills on-chain before we attempt to merge.
   */
  private scheduleMerge(straddle: ActiveStraddle) {
    const match = Math.min(straddle.yesHoldings, straddle.noHoldings);
    if (match <= 0 || straddle.mergeInProgress) {
      return;
    }

    // Reset the debounce timer on every new fill so we batch them together
    if (straddle.mergeDebounceTimer) {
      clearTimeout(straddle.mergeDebounceTimer);
    }

    straddle.mergeDebounceTimer = setTimeout(() => {
      straddle.mergeDebounceTimer = undefined;
      this.executeMerge(straddle);
    }, this.environmentService.environment.mergeDebounceMs);
  }

  private async executeMerge(straddle: ActiveStraddle) {
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

    // Check if more holdings accumulated while we were merging
    if (Math.min(straddle.yesHoldings, straddle.noHoldings) > 0) {
      this.scheduleMerge(straddle);
      return;
    }

    // Check if the straddle is fully complete now that holdings are merged.
    // The cleanup check in handleOrderUpdate may have been skipped because
    // holdings were still > 0 at the time (merge hadn't run yet).
    const isYesDone = straddle.yesStatus === 'FILLED' || straddle.yesStatus === 'CANCELED';
    const isNoDone = straddle.noStatus === 'FILLED' || straddle.noStatus === 'CANCELED';
    if (isYesDone && isNoDone && straddle.yesHoldings < 0.001 && straddle.noHoldings < 0.001) {
      this.logger.debug(`Straddle on condition ${straddle.conditionId} is complete (post-merge). Cleaning up state.`);
      this.cleanupStraddle(straddle);
    }
  }
  // #endregion

  // #region cleanup
  private async cleanupStraddle(straddle: ActiveStraddle) {
    this.logger.debug(`Cleaning up straddle for condition ${straddle.conditionId}`);

    // Clear timers first to prevent concurrent panic exit
    this.clearAllRiskTimers(straddle);

    // Handle any remaining imbalanced holdings BEFORE deleting state
    if (Math.abs(straddle.yesHoldings - straddle.noHoldings) > 0.001) {
      this.logger.warn(
        `Significant holdings remain for condition ${straddle.conditionId} during cleanup: Yes=${straddle.yesHoldings}, No=${straddle.noHoldings}`,
      );
      await this.panicExit(straddle, false); // Don't cleanup again from panicExit
    }

    // Now safe to delete state
    this.positionService.removeStraddle(straddle.conditionId);
    this.orderMap.delete(straddle.yesOrderId);
    this.orderMap.delete(straddle.noOrderId);
    this.alphaService.deleteCondition(straddle.conditionId);

    this.logger.debug(`Straddle for condition ${straddle.conditionId} has been cleaned up.`);
  }

  private async reconcileStraddles() {
    if (this.positionService.straddleCount === 0) {
      return;
    }

    this.logger.debug(`Reconciling ${this.positionService.straddleCount} active straddle(s)...`);

    const staleStraddles: ActiveStraddle[] = [];

    for (const straddle of this.positionService.getStraddles()) {
      try {
        // Fetch current order state from the CLOB API for both legs
        const [yesOrder, noOrder] = await Promise.all([
          this.executionService.getOrder(straddle.yesOrderId).catch(() => null),
          this.executionService.getOrder(straddle.noOrderId).catch(() => null),
        ]);

        let changed = false;

        if (yesOrder) {
          const apiMatched = parseFloat(yesOrder.size_matched);
          const delta = apiMatched - straddle.yesCumulativeFilled;
          if (delta > 0) {
            this.logger.log(`Reconcile drift: YES order on ${straddle.conditionId} — missed ${delta.toFixed(6)} fills`);
            straddle.yesCumulativeFilled = apiMatched;
            straddle.yesHoldings += delta;
            changed = true;
          }
          if (yesOrder.status === 'MATCHED') {
            straddle.yesStatus = 'FILLED';
          } else if (yesOrder.status === 'CANCELED') {
            // Refund unfilled capital for missed cancellation
            if (straddle.yesStatus !== 'CANCELED') {
              const unfilledQty = straddle.quantity - straddle.yesCumulativeFilled;
              if (unfilledQty > 0) {
                this.logger.warn(
                  `Reconcile drift: YES order on ${straddle.conditionId} was CANCELED (missed WS). Refunding ${(straddle.yesPrice * unfilledQty).toFixed(4)}`,
                );
                this.ledgerService.credit(straddle.yesPrice * unfilledQty);
              }
            }
            straddle.yesStatus = 'CANCELED';
          }
        }

        if (noOrder) {
          const apiMatched = parseFloat(noOrder.size_matched);
          const delta = apiMatched - straddle.noCumulativeFilled;
          if (delta > 0) {
            this.logger.log(`Reconcile drift: NO order on ${straddle.conditionId} — missed ${delta.toFixed(6)} fills`);
            straddle.noCumulativeFilled = apiMatched;
            straddle.noHoldings += delta;
            changed = true;
          }
          if (noOrder.status === 'MATCHED') {
            straddle.noStatus = 'FILLED';
          } else if (noOrder.status === 'CANCELED') {
            // Refund unfilled capital for missed cancellation
            if (straddle.noStatus !== 'CANCELED') {
              const unfilledQty = straddle.quantity - straddle.noCumulativeFilled;
              if (unfilledQty > 0) {
                this.logger.warn(
                  `Reconcile drift: NO order on ${straddle.conditionId} was CANCELED (missed WS). Refunding ${(straddle.noPrice * unfilledQty).toFixed(4)}`,
                );
                this.ledgerService.credit(straddle.noPrice * unfilledQty);
              }
            }
            straddle.noStatus = 'CANCELED';
          }
        }

        if (changed) {
          this.scheduleMerge(straddle);
        }

        // Detect stale straddles: both legs terminal and holdings ~0
        const isYesDone = straddle.yesStatus === 'FILLED' || straddle.yesStatus === 'CANCELED';
        const isNoDone = straddle.noStatus === 'FILLED' || straddle.noStatus === 'CANCELED';
        if (isYesDone && isNoDone && straddle.yesHoldings < 0.001 && straddle.noHoldings < 0.001) {
          staleStraddles.push(straddle);
        }
      } catch (error) {
        this.logger.error(`Failed to reconcile straddle ${straddle.conditionId}: ${(error as Error).message}`);
      }
    }

    // Clean up stale straddles (after iteration to avoid mutating the map mid-loop)
    for (const stale of staleStraddles) {
      this.logger.debug(`Cleaning up stale straddle on ${stale.conditionId} (both legs terminal, holdings ~0)`);
      this.cleanupStraddle(stale);
    }

    // Conditional ledger sync
    if (this.environmentService.environment.reconcileLedgerSync) {
      try {
        const walletBalance = await this.ledgerService.getUserBalance();
        const lockedCapital = this.calculateLockedCapital();
        const expectedAvailable = walletBalance - lockedCapital;
        const ghostBalance = this.ledgerService.getAvailableBalance();
        const drift = Math.abs(expectedAvailable - ghostBalance);

        if (drift > 0.01) {
          this.logger.warn(
            `Ledger drift: ${drift.toFixed(4)} (ghost=${ghostBalance.toFixed(4)}, expected=${expectedAvailable.toFixed(4)})`,
          );
          await this.ledgerService.sync(lockedCapital);
        }
      } catch (error) {
        this.logger.error(`Failed to sync ledger during reconciliation: ${(error as Error).message}`);
      }
    }

    this.logger.debug('Reconciliation complete.');
  }
  // #endregion

  // #region risk management
  private async panicExit(straddle: ActiveStraddle, shouldCleanup = true) {
    // Guard against double-execution (both timers firing)
    if (shouldCleanup && !this.positionService.getStraddle(straddle.conditionId)) {
      return;
    }

    this.logger.error(`Initiating panic exit for ${straddle.conditionId}.`);
    straddle.isImbalanced = false;
    this.clearAllRiskTimers(straddle);

    // Cancel any remaining open orders
    const cancelPromises: Promise<void>[] = [];
    if (straddle.yesStatus === 'OPEN') {
      cancelPromises.push(
        this.executionService.cancelOrder(straddle.yesOrderId).catch((err) => {
          this.logger.error(`Failed to cancel YES order ${straddle.yesOrderId}: ${(err as Error).message}`);
        }),
      );
    }
    if (straddle.noStatus === 'OPEN') {
      cancelPromises.push(
        this.executionService.cancelOrder(straddle.noOrderId).catch((err) => {
          this.logger.error(`Failed to cancel NO order ${straddle.noOrderId}: ${(err as Error).message}`);
        }),
      );
    }
    await Promise.all(cancelPromises);

    // Sell any remaining holdings
    if (straddle.yesHoldings > 0 || straddle.noHoldings > 0) {
      try {
        await this.executionService.sellMarketPosition({
          conditionId: straddle.conditionId,
          yesAmount: straddle.yesHoldings,
          noAmount: straddle.noHoldings,
        });
        // Zero out holdings after successful sell
        straddle.yesHoldings = 0;
        straddle.noHoldings = 0;
      } catch (error) {
        this.logger.error(
          `Failed to execute panic sell on condition ${straddle.conditionId}: ${(error as Error).message}`,
        );
        return;
      }
    }

    // Clean up state if called from timer (not from cleanupStraddle)
    if (shouldCleanup) {
      this.positionService.removeStraddle(straddle.conditionId);
      this.orderMap.delete(straddle.yesOrderId);
      this.orderMap.delete(straddle.noOrderId);
    }

    // Re-sync ghost balance from API after panic exit
    const lockedCapital = this.calculateLockedCapital(straddle.conditionId);
    await this.ledgerService.sync(lockedCapital);
  }

  private clearAllRiskTimers(straddle: ActiveStraddle) {
    if (straddle.mergeDebounceTimer) {
      clearTimeout(straddle.mergeDebounceTimer);
      straddle.mergeDebounceTimer = undefined;
    }
    if (straddle.priceDropTimer) {
      clearTimeout(straddle.priceDropTimer);
      straddle.priceDropTimer = undefined;
      straddle.priceDropTimerStartedAt = undefined;
    }
    if (straddle.absoluteTimer) {
      clearTimeout(straddle.absoluteTimer);
      straddle.absoluteTimer = undefined;
    }
  }

  private evaluateLeggingRisk(tick: MarketTick, straddle: ActiveStraddle) {
    // Determine exposed side — whichever we hold more of
    const yesExposed = straddle.yesHoldings > straddle.noHoldings;
    const entryPrice = yesExposed ? straddle.yesPrice : straddle.noPrice;
    const currentBid = yesExposed ? tick.bestBidYes : tick.bestBidNo;
    const drop = entryPrice - currentBid;
    const threshold = this.environmentService.environment.panicPriceDropThreshold;

    if (drop >= threshold) {
      // Price has dropped below threshold — start timer if not running
      if (!straddle.priceDropTimer) {
        this.logger.warn(
          `Price drop detected for ${straddle.conditionId}: ${yesExposed ? 'YES' : 'NO'} bid ${currentBid.toFixed(4)} is ${drop.toFixed(4)} below entry ${entryPrice.toFixed(4)}. Starting sustained drop timer.`,
        );
        straddle.priceDropTimerStartedAt = Date.now();
        straddle.priceDropTimer = setTimeout(
          () => this.panicExit(straddle),
          this.environmentService.environment.panicSustainedDropMs,
        );
      }
    } else {
      // Price has recovered — clear the timer
      if (straddle.priceDropTimer) {
        this.logger.debug(
          `Price recovered for ${straddle.conditionId}: ${yesExposed ? 'YES' : 'NO'} bid ${currentBid.toFixed(4)} is within threshold. Clearing sustained drop timer.`,
        );
        clearTimeout(straddle.priceDropTimer);
        straddle.priceDropTimer = undefined;
        straddle.priceDropTimerStartedAt = undefined;
      }
    }
  }

  /** Calculates total capital locked by active straddles (unfilled orders + unmerged shares). */
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
  // #endregion
}
