import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AssetType, ClobClient } from '@polymarket/clob-client';
import { take } from 'rxjs';
import { formatUnits } from 'viem';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../environment/environment-service';
import { CacheService } from '../cache/cache.service';
import { ClobClientService } from '../clob/client/clob-client.service';
import { ExecutionService } from '../execution/execution.service';
import { LedgerService } from '../ledger/ledger.service';
import { PositionService } from '../position/position.service';

@Injectable()
export class MergeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeService.name);

  private clobClient: ClobClient | null = null;
  private isConfigured = false;
  private interval: NodeJS.Timeout | null = null;
  private cycleInProgress = false;

  constructor(
    private readonly clobClientService: ClobClientService,
    private readonly cacheService: CacheService,
    private readonly executionService: ExecutionService,
    private readonly ledgerService: LedgerService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
    private readonly positionService: PositionService,
  ) {}

  onModuleInit() {
    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
      this.isConfigured = true;
    });

    const intervalMs = this.environmentService.environment.mergeIntervalMs;
    this.logger.log(`Starting merge clock with interval ${intervalMs}ms`);
    this.interval = setInterval(() => this.mergeCycle(), intervalMs);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async mergeCycle() {
    if (this.cycleInProgress) {
      this.logger.debug('Merge cycle already in progress, skipping');
      return;
    }

    if (!this.isConfigured || !this.clobClient) {
      return;
    }

    this.cycleInProgress = true;
    try {
      const markets = Array.from(this.cacheService.markets.values());
      if (markets.length === 0) {
        return;
      }

      this.logger.debug(`Merge cycle: checking ${markets.length} market(s)`);

      await Promise.all(
        markets.map(async (market) => {
          if (!this.clobClient) {
            // this condition is required to satisfy the type checker because we are inside an async callback
            // technically, `clobClient` may become null between the check at the start of the function and here
            return;
          }

          try {
            const [yesBalance, noBalance] = await Promise.allSettled([
              this.clobClient.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: market.yesToken }),
              this.clobClient.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: market.noToken }),
            ]).then(([yesResult, noResult]) => [
              yesResult.status === 'fulfilled' ? parseFloat(formatUnits(BigInt(yesResult.value.balance), 6)) : 0,
              noResult.status === 'fulfilled' ? parseFloat(formatUnits(BigInt(noResult.value.balance), 6)) : 0,
            ]);

            const mergeable = Math.min(yesBalance, noBalance);
            if (mergeable <= 0.001) {
              return;
            }

            this.logger.log(
              `Merging ${mergeable.toFixed(6)} positions on condition ${market.conditionId} (YES=${yesBalance.toFixed(6)}, NO=${noBalance.toFixed(6)})`,
            );

            await this.executionService.mergePositions({
              conditionId: market.conditionId,
              amount: mergeable,
            });

            this.ledgerService.credit(mergeable * 1.0);

            const straddle = this.positionService.getStraddle(market.conditionId);
            if (straddle) {
              straddle.yesHoldings = Math.max(0, straddle.yesHoldings - mergeable);
              straddle.noHoldings = Math.max(0, straddle.noHoldings - mergeable);
            }

            this.osmiumService.trackEvent({
              name: 'merge_service-merge-success',
              metadata: {
                conditionId: market.conditionId,
                amount: mergeable,
                yesBalance,
                noBalance,
                straddleTracked: !!straddle,
              },
            });
          } catch (error) {
            this.logger.error(`Failed to merge positions on ${market.conditionId}: ${(error as Error).message}`);
            this.osmiumService.trackEvent({
              name: 'merge_service-merge-failed',
              metadata: {
                conditionId: market.conditionId,
                reason: (error as Error).message,
              },
            });
          }
        }),
      );
    } finally {
      this.cycleInProgress = false;
    }
  }
}
