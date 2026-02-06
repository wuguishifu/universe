import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AssetType, ClobClient } from '@polymarket/clob-client';
import { take } from 'rxjs';
import { formatUnits } from 'viem';

import { ClobClientService } from '../clob/client/clob-client.service';

@Injectable()
export class LedgerService implements OnModuleInit {
  private readonly logger = new Logger(LedgerService.name);

  private clobClient: ClobClient | null = null;
  private isConfigured = false;
  private availableBalance = 0;

  constructor(private readonly clobClientService: ClobClientService) {}

  onModuleInit() {
    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
      this.isConfigured = true;
    });

    this.getUserBalance().then((balance) => {
      this.availableBalance = balance;
      this.logger.log(`User USDC Balance: ${balance}`);
    });
  }

  public async getUserBalance(): Promise<number> {
    if (!this.isConfigured || !this.clobClient) {
      throw new Error('LedgerService is not configured yet.');
    }

    const { balance } = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return parseFloat(formatUnits(BigInt(balance), 6)); // USDC has 6 decimals
  }

  public debit(amount: number): void {
    this.availableBalance -= amount;
    this.logger.debug(`Debit ${amount.toFixed(4)} USDC. Available: ${this.availableBalance.toFixed(4)}`);
    if (this.availableBalance < 0) {
      this.logger.warn(`Ghost balance went negative: ${this.availableBalance.toFixed(4)}`);
    }
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

  public async sync(lockedCapital = 0): Promise<void> {
    const walletBalance = await this.getUserBalance();
    const adjusted = walletBalance - lockedCapital;
    this.logger.debug(
      `Syncing ghost balance. Was: ${this.availableBalance.toFixed(4)}, API: ${walletBalance.toFixed(4)}, Locked: ${lockedCapital.toFixed(4)}, Adjusted: ${adjusted.toFixed(4)}`,
    );
    this.availableBalance = adjusted;
  }
}
