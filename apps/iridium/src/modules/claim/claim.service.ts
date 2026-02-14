import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AssetType, ClobClient } from '@polymarket/clob-client';
import { take } from 'rxjs';
import { formatUnits } from 'viem';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../environment/environment-service';
import { ClobClientService } from '../clob/client/clob-client.service';
import { ExecutionService } from '../execution/execution.service';

type TrackedMarket = { yesToken: string; noToken: string };

@Injectable()
export class ClaimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimService.name);

  private clobClient: ClobClient | null = null;
  private isConfigured = false;
  private interval: NodeJS.Timeout | null = null;
  private cycleInProgress = false;

  private readonly pendingMarkets = new Map<string, TrackedMarket>();

  constructor(
    private readonly clobClientService: ClobClientService,
    private readonly executionService: ExecutionService,
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  onModuleInit() {
    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
      this.isConfigured = true;
    });

    const intervalMs = this.environmentService.environment.claimIntervalMs;
    this.logger.log(`Starting claim clock with interval ${intervalMs}ms`);
    this.interval = setInterval(() => this.claimCycle(), intervalMs);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  public trackMarket(conditionId: string, yesToken: string, noToken: string) {
    this.pendingMarkets.set(conditionId, { yesToken, noToken });
    this.logger.debug(`Tracking market ${conditionId} for claim redemption`);
  }

  public untrackMarket(conditionId: string) {
    this.pendingMarkets.delete(conditionId);
  }

  private async claimCycle() {
    if (this.cycleInProgress) {
      this.logger.debug('Claim cycle already in progress, skipping');
      return;
    }

    if (!this.isConfigured || !this.clobClient) {
      return;
    }

    if (this.pendingMarkets.size === 0) {
      return;
    }

    this.cycleInProgress = true;
    try {
      this.logger.debug(`Claim cycle: checking ${this.pendingMarkets.size} tracked market(s)`);

      for (const [conditionId, { yesToken, noToken }] of this.pendingMarkets) {
        if (!this.clobClient) {
          break;
        }

        try {
          const [yesBalance, noBalance] = await Promise.allSettled([
            this.clobClient.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: yesToken }),
            this.clobClient.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: noToken }),
          ]).then(([yesResult, noResult]) => [
            yesResult.status === 'fulfilled' && yesResult.value.balance != null
              ? parseFloat(formatUnits(BigInt(yesResult.value.balance), 6))
              : 0,
            noResult.status === 'fulfilled' && noResult.value.balance != null
              ? parseFloat(formatUnits(BigInt(noResult.value.balance), 6))
              : 0,
          ]);

          if (yesBalance <= 0 && noBalance <= 0) {
            this.logger.debug(`No balances for ${conditionId}, removing from tracking`);
            this.pendingMarkets.delete(conditionId);
            continue;
          }

          this.logger.log(
            `Redeeming positions on condition ${conditionId} (YES=${yesBalance.toFixed(6)}, NO=${noBalance.toFixed(6)})`,
          );

          await this.executionService.redeemPositions({ conditionId });

          this.osmiumService.trackEvent({
            name: 'claim_service-claim-success',
            metadata: { conditionId, yesBalance, noBalance },
          });
          this.pendingMarkets.delete(conditionId);
        } catch (error) {
          this.logger.error(`Failed to redeem positions on ${conditionId}: ${(error as Error).message}`);
          this.osmiumService.trackEvent({
            name: 'claim_service-claim-failed',
            metadata: { conditionId, reason: (error as Error).message },
          });
        }
      }
    } finally {
      this.cycleInProgress = false;
    }
  }
}
