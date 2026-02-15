import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../environment/environment-service';
import { DataService } from '../data/data.service';
import { MergeService } from '../merge/merge.service';

@Injectable()
export class OrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private executionInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataService: DataService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly mergeService: MergeService,
  ) {}

  onModuleInit() {
    this.executionInterval = setInterval(
      async () => await this.execute(),
      this.environmentService.environment.executionIntervalMs,
    );
  }

  onModuleDestroy() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }
  }

  private async execute() {
    const positions = await this.dataService.getUserPositions();
    if (!positions.length) {
      this.logger.debug('No positions found, skipping execution cycle');
      this.osmiumService.trackDebug({
        name: 'orchestrator_execution-skipped',
        metadata: { reason: 'no_positions' },
      });
      return;
    }

    // 1. Check for claimportunities and execute them

    // 2. Check for mergeportunities and execute them
    await this.mergeService.merge(positions);
  }
}
