import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../environment/environment-service';
import { Position } from '../../types/position';
import { DataService } from '../data/data.service';
import { RelayerService } from '../relayer/relayer.service';

@Injectable()
export class MergeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeService.name);

  private mergeInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly dataService: DataService,
    private readonly relayerService: RelayerService,
    private readonly osmiumService: OsmiumService,
  ) {}

  onModuleInit() {
    this.mergeInterval = setInterval(
      () => this.executeMergeCycle(),
      this.environmentService.environment.mergeIntervalMs,
    );
  }

  onModuleDestroy() {
    if (this.mergeInterval) {
      clearInterval(this.mergeInterval);
      this.mergeInterval = null;
    }
  }

  private async executeMergeCycle() {
    this.logger.debug('Starting merge cycle');
    this.osmiumService.trackEvent({ name: 'merge_cycle-start' });

    const positions = await this.dataService.getUserPositions({ callSource: 'merge_service' });
    if (!positions.length) {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({ name: 'merge_cycle-skipped', metadata: { reason: 'no_positions' } });
      }
      return;
    }

    const assetToPositionMap = positions.reduce((acc, position) => {
      acc.set(position.asset, position);
      return acc;
    }, new Map<string, Position>());

    const complimentPositions = positions.reduce<[Position, Position][]>((acc, position) => {
      const complimentAsset = assetToPositionMap.get(position.oppositeAsset);
      if (complimentAsset) {
        acc.push([position, complimentAsset]);
        // prevent duplicates by removing both positions from the map
        assetToPositionMap.delete(position.asset);
        assetToPositionMap.delete(position.oppositeAsset);
      }
      return acc;
    }, []);

    if (!complimentPositions.length) {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({ name: 'merge_cycle-skipped', metadata: { reason: 'no_compliments' } });
      }
      return;
    }

    this.osmiumService.trackEvent({
      name: 'merge_cycle-found_compliments',
      metadata: {
        count: complimentPositions.length,
        compliments: complimentPositions.map((compliment) => this.formatComplimentForTracking(compliment)),
      },
    });

    await Promise.all(complimentPositions.map((compliment) => this.mergeCompliment(compliment)));
  }

  private async mergeCompliment(compliment: [Position, Position]) {
    const amount = Math.min(compliment[0].size, compliment[1].size);
    if (amount < 0.01) {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'merge_positions-skipped',
          metadata: { conditionId: compliment[0].conditionId, amount, reason: 'amount_too_small' },
        });
      }
      return;
    }

    try {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'merge_positions-attempt',
          metadata: { conditionId: compliment[0].conditionId, amount },
        });
      }

      if (this.environmentService.environment.dryRun) {
        this.logger.debug('Dry run mode enabled - skipping merge positions');
        this.osmiumService.trackEvent({
          name: 'merge_positions-success',
          metadata: { conditionId: compliment[0].conditionId, amount, dryRun: true },
        });
        return;
      }

      await this.relayerService.mergePositions({ conditionId: compliment[0].conditionId, amount });

      this.osmiumService.trackEvent({
        name: 'merge_positions-success',
        metadata: { conditionId: compliment[0].conditionId, amount },
      });
    } catch (error) {
      this.logger.error(
        `Error merging positions for condition ${compliment[0].conditionId}: ${(error as Error).message}`,
      );
      this.osmiumService.trackEvent({
        name: 'merge_positions-failed',
        metadata: {
          conditionId: compliment[0].conditionId,
          amount,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private formatComplimentForTracking(compliment: [Position, Position]) {
    return {
      title: compliment[0].title,
      eventSlug: compliment[0].eventSlug,
      endDate: compliment[0].endDate,
      assets: compliment.map((pos) => ({
        asset: pos.asset,
        conditionId: pos.conditionId,
        size: pos.size,
        outcome: pos.outcome,
      })),
    };
  }
}
