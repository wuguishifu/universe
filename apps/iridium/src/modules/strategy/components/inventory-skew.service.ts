import { Injectable, Logger } from '@nestjs/common';
import { TickSize } from '@polymarket/clob-client';

import { ActiveStraddle } from './position.service';
import { StraddleManagerService } from './straddle-manager.service';
import { EnvironmentService } from '../../../environment/environment-service';
import { CacheService } from '../../cache/cache.service';
import { ExecutionService } from '../../execution/execution.service';
import { LedgerService } from '../../ledger/ledger.service';

@Injectable()
export class InventorySkewService {
  private readonly logger = new Logger(InventorySkewService.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
    private readonly straddleManagerService: StraddleManagerService,
    private readonly environmentService: EnvironmentService,
    private readonly cacheService: CacheService,
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
    const newHeavyPrice = this.roundDown(straddle[`${heavySide}Price`] - adjustment, tickSize);
    // Light side: RAISE the bid (attract the hedge)
    const newLightPrice = this.roundDown(straddle[`${lightSide}Price`] + adjustment, tickSize);

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

    // 1. Cancel the old order
    // The CANCELLATION message will be processed by handleOrderUpdate,
    // which refunds the unfilled capital via ledgerService.credit()
    await this.executionService.cancelOrder(oldOrderId);

    // 2. Calculate remaining quantity after fills
    const remaining = straddle.quantity - straddle[filledKey];
    if (remaining <= 0) {
      return;
    }

    // 3. Debit capital for the replacement order
    const cost = newPrice * remaining;
    if (!this.ledgerService.hasAvailableCapital(cost)) {
      this.logger.warn(`Insufficient capital for skew replacement on ${straddle.conditionId} ${side.toUpperCase()}`);
      return;
    }
    this.ledgerService.debit(cost);

    // 4. Place replacement at the skewed price
    try {
      const newOrderId = await this.executionService.placeSingleOrder({
        conditionId: straddle.conditionId,
        side,
        price: newPrice,
        quantity: remaining,
      });

      // 5. Update bookkeeping
      this.straddleManagerService.updateOrderMapping(oldOrderId, newOrderId, straddle.conditionId);
      straddle[orderIdKey] = newOrderId;
      straddle[priceKey] = newPrice;
      straddle[statusKey] = 'OPEN';
    } catch (error) {
      // Refund on failure — the cancel already happened so the old order is gone
      this.ledgerService.credit(cost);
      throw error;
    }
  }

  private roundDown(value: number, tickSize: TickSize): number {
    const factor = 1 / parseFloat(tickSize);
    return Math.floor(value * factor) / factor;
  }
}
