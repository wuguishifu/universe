import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';
import { filter, Subscription, tap } from 'rxjs';

import { EnvironmentService } from '../../environment/environment-service';
import { OrderMessage } from '../../types/clob/orderMessage';
import { MarketTick, MarketWsService } from '../clob/ws/market-ws.service';
import { UserWsService } from '../clob/ws/user-ws.service';
import { ExecutionService } from '../execution/execution.service';
import { LedgerService } from '../ledger/ledger.service';

interface ActiveStraddle {
  conditionId: string;

  // Order IDs
  yesOrderId: string;
  noOrderId: string;

  // Order parameters (needed for refund calculations)
  yesPrice: number;
  noPrice: number;
  quantity: number;

  // "Bag" - The shares we currently hold (Available to Merge)
  yesHoldings: number;
  noHoldings: number;

  // API State - Used to calculate Deltas & Status
  yesCumulativeFilled: number; // The 'size_matched' from last message
  noCumulativeFilled: number; // The 'size_matched' from last message

  yesStatus: 'OPEN' | 'FILLED' | 'CANCELED';
  noStatus: 'OPEN' | 'FILLED' | 'CANCELED';

  // Merge concurrency control
  mergeInProgress: boolean;
  mergeDebounceTimer?: NodeJS.Timeout;

  // Legging risk timers
  priceDropTimer?: NodeJS.Timeout;
  absoluteTimer?: NodeJS.Timeout;
  priceDropTimerStartedAt?: number;
  isImbalanced: boolean;
}

@Injectable()
export class StrategyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyService.name);

  /** conditionId -> StraddleState */
  private readonly activeStraddles = new Map<string, ActiveStraddle>();

  /** conditionId being processed */
  private readonly marketsInProgress = new Set<string>();

  /** orderId -> conditionId */
  private readonly orderMap = new Map<string, string>();

  /** RxJS subscriptions to clean up on destroy */
  private readonly subscriptions: Subscription[] = [];

  /** Periodic reconciliation timer */
  private reconcileInterval: NodeJS.Timeout | null = null;

  /** Per-market throttle tracking (conditionId -> last evaluation timestamp) */
  private readonly lastEvalTime = new Map<string, number>();

  /** Price history for stability checking (conditionId -> array of {yesPrice, noPrice, timestamp}) */
  private readonly priceHistory = new Map<string, Array<{ yesPrice: number; noPrice: number; timestamp: number }>>();

  constructor(
    private readonly userWsService: UserWsService,
    private readonly marketWsService: MarketWsService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
    private readonly ledgerService: LedgerService,
  ) {}

  // #region: module lifecycle

  public onModuleInit() {
    // entry pipe
    const marketTickSub = this.marketWsService.marketTicks$
      // MARK: market filtering
      .pipe(
        tap((tick) => this.recordPriceHistory(tick)),
        filter((tick) => this.filterForTimeRemaining(tick)),
        filter((tick) => this.filterForSkew(tick)),
        filter((tick) => this.filterForStability(tick)),
        filter((tick) => this.filterForThrottling(tick)),
        tap((tick) => this.lastEvalTime.set(tick.conditionId, Date.now())),
      )
      .subscribe((tick) => this.evaluateStraddle(tick));
    this.subscriptions.push(marketTickSub);

    // legging risk pipe — monitor price for imbalanced straddles
    const riskTickSub = this.marketWsService.marketTicks$
      .pipe(
        filter((tick) => {
          const straddle = this.activeStraddles.get(tick.conditionId);
          return !!straddle?.isImbalanced;
        }),
      )
      .subscribe((tick) => {
        const straddle = this.activeStraddles.get(tick.conditionId);
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
    this.lastEvalTime.clear();
    this.priceHistory.clear();

    // Clear periodic reconciliation timer
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    if (this.activeStraddles.size === 0) {
      this.logger.debug('No active straddles to clean up');
      return;
    }

    this.logger.debug(`Cleaning up ${this.activeStraddles.size} active straddles...`);

    // MARK: cancel open orders
    const cancelPromises: Promise<void>[] = [];
    for (const straddle of this.activeStraddles.values()) {
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
    for (const straddle of this.activeStraddles.values()) {
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

  // #region core evaluation logic

  // MARK: evaluate straddle
  private async evaluateStraddle(tick: MarketTick) {
    // skip if already active or in progress
    if (this.activeStraddles.has(tick.conditionId) || this.marketsInProgress.has(tick.conditionId)) {
      return;
    }

    // calculate base target bids
    const targetEntry = this.environmentService.environment.targetEntry;
    const currentSpread = tick.bestBidYes + tick.bestBidNo;
    const baseDiscount = Math.max((currentSpread - targetEntry) / 2, 0);
    let targetYes = tick.bestBidYes - baseDiscount;
    let targetNo = tick.bestBidNo - baseDiscount;

    // apply momentum
    const kinematics = this.calculateKinematics({
      conditionId: tick.conditionId,
      currentYes: tick.bestBidYes,
      currentNo: tick.bestBidNo,
    });
    if (this.environmentService.environment.enableMomentumDiscounting) {
      if (!kinematics) {
        // warmup period - not enough data to calculate kinematics, so cancel this tick but allow future ticks to be evaluated
        return;
      }
      const { yesAdj, noAdj } = kinematics;
      targetYes = Math.min(targetYes + yesAdj, tick.bestBidYes);
      targetNo = Math.min(targetNo + noAdj, tick.bestBidNo);
    }

    targetYes = this.roundDown(targetYes, tick.minTickSize);
    targetNo = this.roundDown(targetNo, tick.minTickSize);
    if (targetYes <= 0 || targetNo <= 0) {
      return;
    }

    if (targetYes > tick.bestBidYes || targetNo > tick.bestBidNo) {
      this.logger.warn(`Calculated target bids are worse than current bids for market ${tick.conditionId}. Skipping.`);
      return;
    }

    if (targetYes + targetNo > 1.0) {
      return;
    }

    // check available capital
    const quantity = this.environmentService.environment.targetPositionSize;
    const requiredCapital = (targetYes + targetNo) * quantity;
    if (!this.ledgerService.hasAvailableCapital(requiredCapital)) {
      this.logger.debug(
        `Insufficient capital for ${tick.conditionId}. Required: ${requiredCapital.toFixed(4)}, Available: ${this.ledgerService.getAvailableBalance().toFixed(4)}`,
      );
      return;
    }

    this.marketsInProgress.add(tick.conditionId);
    this.logger.log(
      `Opportunity on ${tick.conditionId} (Skew: ${tick.bestBidYes}/${tick.bestBidNo}). Placing Skewed Limits: Yes@${targetYes} | No@${targetNo}`,
    );

    try {
      // debit capital from ghost ledger
      this.ledgerService.debit(requiredCapital);

      // place limit orders
      const { yesOrderId, noOrderId } = await this.executionService.placeLimitOrder({
        conditionId: tick.conditionId,
        targetYes,
        targetNo,
        quantity,
      });

      this.activeStraddles.set(tick.conditionId, {
        conditionId: tick.conditionId,
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
      this.orderMap.set(yesOrderId, tick.conditionId);
      this.orderMap.set(noOrderId, tick.conditionId);
      this.marketsInProgress.delete(tick.conditionId);
    } catch (error) {
      this.logger.error(`Failed to place limit order on ${tick.conditionId}: ${(error as Error).message}`);
      this.marketsInProgress.delete(tick.conditionId);

      this.ledgerService.credit(requiredCapital); // refund capital on failure
    }
  }

  // MARK: order update
  private handleOrderUpdate(update: OrderMessage) {
    // find context
    const conditionId = this.orderMap.get(update.id);
    if (!conditionId) {
      this.logger.warn(`Received order update for unknown orderId: ${update.id}`);
      return;
    }

    const straddle = this.activeStraddles.get(conditionId);
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

  /**
   * MARK: kinematics
   * Calculates 2nd Order Dynamics (Velocity & Acceleration).
   * Returns price adjustments based on the "Curve" of the movement.
   */
  private calculateKinematics({
    conditionId,
    currentYes,
    currentNo,
  }: {
    conditionId: string;
    currentYes: number;
    currentNo: number;
  }): { yesAdj: number; noAdj: number } | null {
    const history = this.priceHistory.get(conditionId);
    if (!history || history.length < 3) {
      return null;
    }

    // Look back 2 seconds and 4 seconds
    const now = Date.now();
    const t1 = now - 2000;
    const t2 = now - 4000;

    if (history[0].timestamp > t2) {
      return null;
    }

    // Find nearest history points
    const p1 = history.find((h) => h.timestamp <= t1);
    const p2 = history.find((h) => h.timestamp <= t2);
    if (!p1 || !p2) {
      return null;
    }

    // --- YES SIDE KINEMATICS ---
    const vYes0 = currentYes - p1.yesPrice;
    const vYes1 = p1.yesPrice - p2.yesPrice;
    const aYes = vYes0 - vYes1;

    // --- NO SIDE KINEMATICS ---
    const vNo0 = currentNo - p1.noPrice;
    const vNo1 = p1.noPrice - p2.noPrice;
    const aNo = vNo0 - vNo1;

    // PREDICTION FORMULA:
    // Future ≈ Current + (V * k1) + (A * k2)
    const { velocityFactor, accelerationFactor, maxDiscount } = this.environmentService.environment;
    const yesAdj = Math.max(-maxDiscount, Math.min(vYes0 * velocityFactor + aYes * accelerationFactor, 0));
    const noAdj = Math.max(-maxDiscount, Math.min(vNo0 * velocityFactor + aNo * accelerationFactor, 0));

    return { yesAdj, noAdj };
  }

  private recordPriceHistory(tick: MarketTick) {
    if (tick.bestBidYes <= 0.01 || tick.bestBidNo <= 0.01) {
      return;
    }
    if (tick.bestBidYes >= 0.99 || tick.bestBidNo >= 0.99) {
      return;
    }

    let history = this.priceHistory.get(tick.conditionId);
    if (!history) {
      history = [];
      this.priceHistory.set(tick.conditionId, history);
    }

    history.push({
      yesPrice: tick.bestBidYes,
      noPrice: tick.bestBidNo,
      timestamp: tick.timestamp,
    });

    const cutoffTime = tick.timestamp - this.environmentService.environment.maxHistoryRetentionMs;
    while (history.length > 0 && history[0].timestamp < cutoffTime) {
      history.shift();
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
    this.activeStraddles.delete(straddle.conditionId);
    this.orderMap.delete(straddle.yesOrderId);
    this.orderMap.delete(straddle.noOrderId);
    this.lastEvalTime.delete(straddle.conditionId);
    this.priceHistory.delete(straddle.conditionId);

    this.logger.debug(`Straddle for condition ${straddle.conditionId} has been cleaned up.`);
  }

  private async reconcileStraddles() {
    if (this.activeStraddles.size === 0) {
      return;
    }

    this.logger.debug(`Reconciling ${this.activeStraddles.size} active straddle(s)...`);

    const staleStraddles: ActiveStraddle[] = [];

    for (const straddle of this.activeStraddles.values()) {
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
    if (shouldCleanup && !this.activeStraddles.has(straddle.conditionId)) {
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
      this.activeStraddles.delete(straddle.conditionId);
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
    for (const [conditionId, s] of this.activeStraddles) {
      if (conditionId === excludeConditionId) {
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

  /** Rounds down to 2 decimal places (requirement by PolyMarket) */
  private roundDown(value: number, tickSize: TickSize): number {
    const factor = 1 / parseFloat(tickSize);
    return Math.floor(value * factor) / factor;
  }

  // #endregion

  // #region filtering

  /**
   * MARK: filter for price stability (prevents entering during spikes)
   * TODO: there is a known edge case where a market could be unstable but near a skew boundary which would cause
   * TODO: ticks to be filtered out earlier and would make this market appear stable.
   * Updates price history and checks if the market has been stable.
   */
  private filterForStability(tick: MarketTick): boolean {
    const { priceStabilityRangeCents, priceStabilityDurationMs, enablePriceStabilityCheck } =
      this.environmentService.environment;

    if (!enablePriceStabilityCheck) {
      return true;
    }
    if (!priceStabilityRangeCents || !priceStabilityDurationMs) {
      return true;
    }

    const history = this.priceHistory.get(tick.conditionId);

    // 1. Cold Start Check
    // If we have no history, or the history is too short to cover the required duration
    if (!history || history.length < 2) {
      // Optional: Log debug "Cold start"
      return false;
    }

    // 2. Coverage Check
    // We need to ensure our history spans at least 'priceStabilityDurationMs'
    const oldestAllowedTimestamp = tick.timestamp - priceStabilityDurationMs;
    const oldestDataPoint = history[0].timestamp;

    if (oldestDataPoint > oldestAllowedTimestamp) {
      // Our history only goes back 1 second, but we need 2 seconds to prove stability.
      // We are not ready yet.
      return false;
    }

    // 3. Stability Calculation
    const rangeDollars = priceStabilityRangeCents / 100;

    // We iterate backwards (newest to oldest) as an optimization,
    // but forward works too. We only check points within the duration window.
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];

      // Stop checking if we go past the duration window
      if (entry.timestamp < oldestAllowedTimestamp) {
        break;
      }

      const yesDelta = Math.abs(entry.yesPrice - tick.bestBidYes);
      const noDelta = Math.abs(entry.noPrice - tick.bestBidNo);

      if (yesDelta > rangeDollars || noDelta > rangeDollars) {
        this.logger.debug(
          `Unstable ${tick.conditionId}: Deviation > ${rangeDollars} within last ${priceStabilityDurationMs}ms`,
        );
        return false;
      }
    }

    return true;
  }

  private filterForTimeRemaining(tick: MarketTick): boolean {
    if (tick.timeRemaining > this.environmentService.environment.maxTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too much)`);
      return false;
    }

    if (tick.timeRemaining <= this.environmentService.environment.minTimeRemainingMs) {
      this.logger.debug(`Skipping market ${tick.conditionId} with time remaining ${tick.timeRemaining}ms (too little)`);
      return false;
    }

    return true;
  }

  // MARK: filter for skew and total cost (prevents entering when market is too skewed or illiquid)
  private filterForSkew(tick: MarketTick): boolean {
    if (!this.environmentService.environment.enableSkewCheck) {
      return true;
    }

    const { minSkewPriceCutoff, minTotalCost, maxTotalCost } = this.environmentService.environment;
    if (tick.bestBidNo <= minSkewPriceCutoff || tick.bestBidYes <= minSkewPriceCutoff) {
      this.logger.debug(
        `Skipping market ${tick.conditionId} with bids Yes:${tick.bestBidYes.toFixed(4)} No:${tick.bestBidNo.toFixed(4)} (too skewed)`,
      );
      return false;
    }

    const totalCost = tick.bestBidYes + tick.bestBidNo;
    if (totalCost <= minTotalCost) {
      this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too low)`);
      return false;
    }

    if (totalCost >= maxTotalCost) {
      this.logger.debug(`Skipping market ${tick.conditionId} with total cost ${totalCost.toFixed(4)} (too high)`);
      return false;
    }

    return true;
  }

  // MARK: throttle per-market to avoid rapid re-evaluation
  private filterForThrottling(tick: MarketTick): boolean {
    const now = Date.now();
    const lastTime = this.lastEvalTime.get(tick.conditionId) ?? 0;
    return now - lastTime >= 100;
  }

  // #endregion
}
