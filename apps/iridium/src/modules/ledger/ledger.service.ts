import { Injectable, OnModuleInit } from '@nestjs/common';
import { AssetType, ClobClient } from '@polymarket/clob-client';
import { take } from 'rxjs';
import { formatUnits } from 'viem';

import { ClobClientService } from '../clob/client/clob-client.service';

@Injectable()
export class LedgerService implements OnModuleInit {
  private clobClient: ClobClient | null = null;
  private isConfigured = false;

  constructor(private readonly clobClientService: ClobClientService) {}

  onModuleInit() {
    this.clobClientService.clobClient$.pipe(take(1)).subscribe((client) => {
      this.clobClient = client;
      this.isConfigured = true;
    });

    this.getUserBalance().then((balance) => console.log('User USDC Balance:', balance));
  }

  public async getUserBalance(): Promise<number> {
    if (!this.isConfigured || !this.clobClient) {
      throw new Error('LedgerService is not configured yet.');
    }

    const { balance } = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    return parseFloat(formatUnits(BigInt(balance), 6)); // USDC has 6 decimals
  }
}
