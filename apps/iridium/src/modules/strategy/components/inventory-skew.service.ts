import { Injectable, Logger } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';

import { OsmiumService } from '@wuguishifu/nest-common';

import { StraddleManagerService } from './straddle-manager.service';
import { EnvironmentService } from '../../../environment/environment-service';
import { CacheService } from '../../cache/cache.service';
import { ExecutionService } from '../../execution/execution.service';
import { LedgerService } from '../../ledger/ledger.service';
import { ActiveStraddle } from '../../position/position.service';

@Injectable()
export class InventorySkewService {
  private readonly logger = new Logger(InventorySkewService.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
    private readonly straddleManagerService: StraddleManagerService,
    private readonly environmentService: EnvironmentService,
    private readonly cacheService: CacheService,
    private readonly osmiumService: OsmiumService,
  ) {}

  public async onFill(straddle: ActiveStraddle) {
    if (!this.environmentService.environment.enableInventorySkew) {
      return;
    }

    if (straddle.skewInProgress) {
      return;
    }

    const netPosition = straddle.yesHoldings - straddle.noHoldings;
    if (netPosition === 0) {
      return;
    }

    const heavySide: 'yes' | 'no' = netPosition > 0 ? 'yes' : 'no';
    const lightSide: 'yes' | 'no' = netPosition > 0 ? 'no' : 'yes';
    const heavyStatus = straddle[`${heavySide}Status`];
    const lightStatus = straddle[`${lightSide}Status`];

    // Nothing to adjust if both sides are terminal
    if (heavyStatus !== 'OPEN' && lightStatus !== 'OPEN') {
      return;
    }

    const { skewCentsPerShare, maxSkewAdjustment } = this.environmentService.environment;
    const imbalance = Math.abs(netPosition);
    const rawAdjustment = (imbalance * skewCentsPerShare) / 100;
    const adjustment = Math.min(rawAdjustment, maxSkewAdjustment);

    const market = this.cacheService.markets.get(straddle.conditionId);
    if (!market) {
      this.logger.warn(`No market metadata for ${straddle.conditionId}, skipping skew`);
      return;
    }

    const tickSize = market.orderPriceMinTickSize;

    // Heavy side: LOWER the bid (discourage more accumulation)
    const newHeavyPrice = this.roundPrice(straddle[`${heavySide}Price`] - adjustment, tickSize, 'down');
    // Light side: RAISE the bid (attract the hedge)
    const newLightPrice = this.roundPrice(straddle[`${lightSide}Price`] + adjustment, tickSize, 'up');

    if (newHeavyPrice < 0.01 || newLightPrice < 0.01) {
      this.logger.debug(`Skew adjustment would push price below minimum for ${straddle.conditionId}`);
      return;
    }

    if (newHeavyPrice + newLightPrice > 1.0) {
      this.logger.debug(`Skew adjustment would violate no-arbitrage for ${straddle.conditionId}`);
      return;
    }

    // Check if any price actually changed
    const heavyPriceChanged = newHeavyPrice !== straddle[`${heavySide}Price`];
    const lightPriceChanged = newLightPrice !== straddle[`${lightSide}Price`];
    if (!heavyPriceChanged && !lightPriceChanged) {
      return;
    }

    straddle.skewInProgress = true;

    this.osmiumService.trackEvent({
      name: 'skew-adjustment',
      metadata: {
        conditionId: straddle.conditionId,
        heavySide,
        lightSide,
        imbalance,
        adjustment,
        oldHeavyPrice: straddle[`${heavySide}Price`],
        newHeavyPrice,
        oldLightPrice: straddle[`${lightSide}Price`],
        newLightPrice,
        yesHoldings: straddle.yesHoldings,
        noHoldings: straddle.noHoldings,
      },
    });

    this.logger.log(
      `Skewing ${straddle.conditionId}: imbalance=${imbalance.toFixed(2)} (${heavySide} heavy). ` +
        `${heavySide.toUpperCase()} ${straddle[`${heavySide}Price`]}→${newHeavyPrice}, ` +
        `${lightSide.toUpperCase()} ${straddle[`${lightSide}Price`]}→${newLightPrice}`,
    );

    try {
      // Adjust light side first — getting the hedge is the priority
      if (lightPriceChanged && lightStatus === 'OPEN') {
        await this.cancelAndReplace(straddle, lightSide, newLightPrice, tickSize);
      }
      if (heavyPriceChanged && heavyStatus === 'OPEN') {
        await this.cancelAndReplace(straddle, heavySide, newHeavyPrice, tickSize);
      }
    } catch (error) {
      this.logger.error(`Skew adjustment failed on ${straddle.conditionId}: ${(error as Error).message}`);
      this.osmiumService.trackEvent({
        name: 'skew-adjustment-failed',
        metadata: { conditionId: straddle.conditionId, reason: (error as Error).message },
      });
    } finally {
      straddle.skewInProgress = false;
    }
  }

  private async cancelAndReplace(straddle: ActiveStraddle, side: 'yes' | 'no', newPrice: number, tickSize: TickSize) {
    const orderIdKey = `${side}OrderId` as const;
    const priceKey = `${side}Price` as const;
    const filledKey = `${side}CumulativeFilled` as const;
    const statusKey = `${side}Status` as const;

    const oldOrderId = straddle[orderIdKey];

    // * 1. Calculate the 'locked' capital we are about to free up
    // We must use the OLD price and the REMAINING quantity
    const currentFilled = straddle[filledKey];
    const remaining = straddle.quantity - currentFilled;

    if (remaining <= 0) {
      this.logger.debug(`Skipping skew replacement: ${side} side fully filled.`);
      return;
    }

    const oldPrice = straddle[priceKey];
    const capitalFreed = remaining * oldPrice;

    // * 2. Calculate the NEW capital requirement
    const capitalRequired = remaining * newPrice;

    // * 3. Net Capital Check
    // We temporarily add 'capitalFreed' to our available balance for this check
    // If (Available + Freed) < Required, we actually don't have enough money.
    // Note: You might need to add a method to LedgerService for this specific check
    // or just trust the math here if LedgerService exposes raw available balance.
    if (!this.ledgerService.hasAvailableCapital(capitalRequired - capitalFreed)) {
      this.logger.warn(
        `Insufficient capital for skew replacement on ${straddle.conditionId} ${side.toUpperCase()}. ` +
          `Need: ${capitalRequired.toFixed(2)}, Freed: ${capitalFreed.toFixed(2)}`,
      );
      return;
    }

    // * 4. Cancel the old order
    // ! We act as if the cancel is successful immediately for capital purposes.
    // If the cancel fails, we must revert this logic.
    try {
      await this.executionService.cancelOrder(oldOrderId, straddle.conditionId);

      // * 5. MANUAL Ledger Adjustment (Optimistic Unlock)
      // We credit the ledger NOW, before the WebSocket confirms the cancel.
      // This prevents the race condition where we wait for the WS to give us money back.
      this.ledgerService.credit(capitalFreed);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${oldOrderId}: ${(error as Error).message}`);
      // If cancel fails, we never credited the ledger, so no rollback needed.
      return;
    }

    // * 6. Place replacement at the skewed price
    try {
      // Debit for the new order
      this.ledgerService.debit(capitalRequired, 'InventorySkewService.cancelAndReplace');

      const newOrderId = await this.executionService.placeSingleOrder({
        conditionId: straddle.conditionId,
        side,
        price: newPrice,
        quantity: remaining,
      });

      // * 7. Update bookkeeping
      this.straddleManagerService.updateOrderMapping(oldOrderId, newOrderId, straddle.conditionId);
      straddle[orderIdKey] = newOrderId;
      straddle[priceKey] = newPrice;
      straddle[statusKey] = 'OPEN';
    } catch (error) {
      // * 8. ROLLBACK on Placement Failure
      // If placement fails, we have already credited 'capitalFreed' (from the cancel)
      // and debited 'capitalRequired'. We need to refund the debit.
      // The 'capitalFreed' stays credited because the old order IS canceled.
      this.ledgerService.credit(capitalRequired);

      this.logger.error(`Failed to place replacement order for ${straddle.conditionId}: ${(error as Error).message}`);

      // Note: The straddle is now in a "broken" state (one leg canceled, no replacement).
      // You might want to set status to 'CANCELED' here or trigger a full close.
      straddle[statusKey] = 'CANCELED';
    }
  }

  private roundPrice(value: number, tickSize: TickSize, direction: 'up' | 'down'): number {
    const factor = 1 / parseFloat(tickSize);
    if (direction === 'up') {
      return Math.ceil(value * factor) / factor;
    }
    return Math.floor(value * factor) / factor;
  }
}
