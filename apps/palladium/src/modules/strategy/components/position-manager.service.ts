import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../../environment/environment-service';
import { MarketWsService } from '../../clob-ws/market-ws.service';

type OpenPosition = {
  conditionId: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  quantity: number;
  targetExitPrice: number;
  placedAt: number;
  exitTimeoutHandle: NodeJS.Timeout;
  lastKnownBid: number;
};

export type ExitSignal = {
  conditionId: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  quantity: number;
  reason: 'target' | 'timeout';
  currentBid: number;
};

@Injectable()
export class PositionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PositionManagerService.name);

  private readonly positions = new Map<string, OpenPosition>();
  private readonly exitSignalSubject = new Subject<ExitSignal>();
  public readonly exitSignal$ = this.exitSignalSubject.asObservable();

  private subscription: Subscription | null = null;

  constructor(
    private readonly marketWsService: MarketWsService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  onModuleInit() {
    this.subscription = this.marketWsService.marketTicks$.subscribe((tick) => {
      const position = this.positions.get(tick.conditionId);
      if (!position) {
        return;
      }

      const currentBid = position.side === 'YES' ? tick.bestBidYes : tick.bestBidNo;
      position.lastKnownBid = currentBid;

      const msHeld = Date.now() - position.placedAt;

      this.osmiumService.trackDebug({
        name: 'position-monitor-tick',
        metadata: {
          conditionId: position.conditionId,
          side: position.side,
          currentBid,
          targetExitPrice: position.targetExitPrice,
          distanceToTarget: position.targetExitPrice - currentBid,
          msHeld,
        },
      });

      if (currentBid >= position.targetExitPrice) {
        this.emitExitSignal(position, 'target', currentBid);
      }
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    for (const position of this.positions.values()) {
      clearTimeout(position.exitTimeoutHandle);
    }
    this.positions.clear();
    this.exitSignalSubject.complete();
  }

  public addPosition(pos: { conditionId: string; side: 'YES' | 'NO'; entryPrice: number; quantity: number }) {
    const { targetReturnMultiplier, exitTimeoutMs } = this.environmentService.environment;
    const targetExitPrice = pos.entryPrice * targetReturnMultiplier;
    const placedAt = Date.now();

    const exitTimeoutHandle = setTimeout(() => {
      const position = this.positions.get(pos.conditionId);
      if (!position) {
        return;
      }
      this.emitExitSignal(position, 'timeout', position.lastKnownBid);
    }, exitTimeoutMs);

    const position: OpenPosition = {
      ...pos,
      targetExitPrice,
      placedAt,
      exitTimeoutHandle,
      lastKnownBid: 0,
    };

    this.positions.set(pos.conditionId, position);
    this.logger.debug(`Position opened: ${pos.conditionId} ${pos.side} @ ${pos.entryPrice}, target=${targetExitPrice}`);

    this.osmiumService.trackEvent({
      name: 'position-opened',
      metadata: {
        conditionId: pos.conditionId,
        side: pos.side,
        entryPrice: pos.entryPrice,
        quantity: pos.quantity,
        targetExitPrice,
      },
    });
  }

  public removePosition(conditionId: string) {
    const position = this.positions.get(conditionId);
    if (!position) {
      return;
    }
    clearTimeout(position.exitTimeoutHandle);
    this.positions.delete(conditionId);
  }

  private emitExitSignal(position: OpenPosition, reason: 'target' | 'timeout', currentBid: number) {
    if (!this.positions.has(position.conditionId)) {
      return;
    }
    this.positions.delete(position.conditionId);
    clearTimeout(position.exitTimeoutHandle);

    const msHeld = Date.now() - position.placedAt;

    this.osmiumService.trackEvent({
      name: 'position-exit-triggered',
      metadata: {
        conditionId: position.conditionId,
        side: position.side,
        reason,
        currentBid,
        entryPrice: position.entryPrice,
        msHeld,
        estimatedPnl: (currentBid - position.entryPrice) * position.quantity,
      },
    });

    this.exitSignalSubject.next({
      conditionId: position.conditionId,
      side: position.side,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      reason,
      currentBid,
    });
  }
}
