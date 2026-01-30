import { Injectable, Logger } from '@nestjs/common';

import { Market } from '../../types/market';
import { Straddle } from '../../types/straddle';
import { getTimeRemainingMs, isExpired } from '../../utils/market.utils';
import { getBestPrice } from '../../utils/order-book.utils';
import { CacheService } from '../cache/cache.service';
import { ExecutionService } from '../execution/execution.service';
import { GateService } from '../gate/gate.service';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly gateService: GateService,
    private readonly cacheService: CacheService,
    private readonly executionService: ExecutionService,
  ) {}

  public evaluateMarket(market: Market) {
    if (isExpired(market)) {
      return;
    }

    if (!this.gateService.checkTime(market)) {
      return;
    }

    const yesBook = this.cacheService.orderBooks.get(market.yesToken);
    const noBook = this.cacheService.orderBooks.get(market.noToken);
    if (!yesBook || !noBook) {
      return;
    }

    const bestYesPrice = getBestPrice(yesBook);
    const bestNoPrice = getBestPrice(noBook);
    if (!bestYesPrice || !bestNoPrice) {
      return;
    }

    const straddle = this.getOrCreateStraddle(market.cacheKey);
    let position = straddle.position;
    if ((position?.yesShares ?? 0) > 0 && (position?.noShares ?? 0) > 0) {
      // TODO: log completed straddle
      this.logger.log(`Completed straddle on market ${market.slug} (${market.question})`);
      // reset position
      position = straddle.position = undefined;
    }

    // MARK: NO check
    if (position?.yesShares && position.yesShares > 0 && (!position?.noShares || position?.noShares === 0)) {
      // has yes, check if no is cheap enough
      const breakEven = 1 - (position.averageYesPrice ?? 0);
      // TODO: maybe we want to add a minimum profit margin here? `(breakEven * 0.95)`
      if (bestNoPrice < breakEven && this.gateService.checkDepth(yesBook, noBook)) {
        return this.executionService.queueCompletion({
          market,
          straddle,
          checkSide: 'no',
          checkPrice: bestNoPrice,
          checkToken: market.noToken,
          threshold: breakEven,
          yesPrice: bestYesPrice,
          noPrice: bestNoPrice,
          timeRemainingMs: getTimeRemainingMs(market),
        });
      }
    }

    // MARK: YES check
    if (position?.noShares && position.noShares > 0 && (!position?.yesShares || position?.yesShares === 0)) {
      const breakEven = 1 - (position.averageNoPrice ?? 0);
      // TODO: maybe we want to add a minimum profit margin here? `(breakEven * 0.95)`
      if (bestYesPrice < breakEven && this.gateService.checkDepth(yesBook, noBook)) {
        return this.executionService.queueCompletion({
          market,
          straddle,
          checkSide: 'yes',
          checkPrice: bestYesPrice,
          checkToken: market.yesToken,
          threshold: breakEven,
          yesPrice: bestYesPrice,
          noPrice: bestNoPrice,
          timeRemainingMs: getTimeRemainingMs(market),
        });
      }
    }

    // MARK: new straddle check
    if (!this.gateService.checkAll(market, yesBook, noBook)) {
      return;
    }
  }

  private getOrCreateStraddle(cacheKey: string): Straddle {
    const existingStraddle = this.cacheService.straddles.get(cacheKey);
    if (existingStraddle) {
      return existingStraddle;
    }

    const newStraddle: Straddle = { createdAtMs: Date.now() };
    this.cacheService.straddles.set(cacheKey, newStraddle);
    return newStraddle;
  }
}
