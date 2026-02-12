import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AssetType, ClobClient } from '@polymarket/clob-client';
import { take } from 'rxjs';
import { formatUnits } from 'viem';

import { EnvironmentService } from '../../environment/environment-service';
import { ClobClientService } from '../clob/client/clob-client.service';

@Injectable()
export class LedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerService.name);

  private clobClient: ClobClient | null = null;
  private availableBalance = 0;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly clobClientService: ClobClientService,
    private readonly environmentService: EnvironmentService,
  ) {}

  onModuleInit() {
    const { maxAllocationRatio, ledgerSyncIntervalMs } = this.environmentService.environment;

    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
    });

    this.getUserBalance().then((balance) => {
      this.availableBalance = balance * maxAllocationRatio;
      this.logger.log(
        `User USDC Balance: ${balance}, Allocation Ratio: ${maxAllocationRatio}, Available: ${this.availableBalance.toFixed(4)}`,
      );
    });

    this.logger.log(`Ledger sync interval: ${ledgerSyncIntervalMs}ms`);
    this.syncInterval = setInterval(() => this.syncWithReality(), ledgerSyncIntervalMs);
  }

  onModuleDestroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  public async getUserBalance(): Promise<number> {
    if (!this.clobClient) {
      throw new Error('LedgerService is not configured yet.');
    }

    const { balance } = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return parseFloat(formatUnits(BigInt(balance), 6)); // USDC has 6 decimals
  }

  public debit(amount: number): void {
    if (!this.hasAvailableCapital(amount)) {
      this.logger.warn(`Attempted to debit ${amount} USDC, but only ${this.availableBalance} USDC is available.`);
      throw new Error(
        `Insufficient available balance. Attempted to debit ${amount}, but only ${this.availableBalance} is available.`,
      );
    }
    this.availableBalance -= amount;
    this.logger.debug(`Debit ${amount.toFixed(4)} USDC. Available: ${this.availableBalance.toFixed(4)}`);
  }

  public credit(amount: number): void {
    this.availableBalance += amount;
    this.logger.debug(`Credit ${amount.toFixed(4)} USDC. Available: ${this.availableBalance.toFixed(4)}`);
  }

  public hasAvailableCapital(amount: number): boolean {
    return this.availableBalance >= amount;
  }

  public getAvailableBalance(): number {
    return this.availableBalance;
  }

  private async syncWithReality(): Promise<void> {
    if (!this.clobClient) {
      return;
    }

    try {
      const { maxAllocationRatio } = this.environmentService.environment;
      const walletBalance = await this.getUserBalance();
      const openOrders = await this.clobClient.getOpenOrders();

      let lockedCapital = 0;
      for (const order of openOrders) {
        const price = parseFloat(order.price);
        const unfilled = parseFloat(order.original_size) - parseFloat(order.size_matched);
        lockedCapital += price * unfilled;
      }

      const adjusted = walletBalance * maxAllocationRatio - lockedCapital;
      const drift = Math.abs(adjusted - this.availableBalance);

      if (drift > 0.01) {
        this.logger.warn(
          `Ledger drift detected: ${drift.toFixed(4)}. Was: ${this.availableBalance.toFixed(4)}, Adjusted: ${adjusted.toFixed(4)} (wallet=${walletBalance.toFixed(4)}, ratio=${maxAllocationRatio}, locked=${lockedCapital.toFixed(4)})`,
        );
      }

      this.availableBalance = adjusted;
    } catch (error) {
      this.logger.error(`Failed to sync ledger: ${(error as Error).message}`);
    }
  }
}
