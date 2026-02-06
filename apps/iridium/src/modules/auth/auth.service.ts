import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiKeyCreds, ClobClient } from '@polymarket/clob-client';
import { ReplaySubject } from 'rxjs';

import { CLOB_API_BASE, POLYGON_CHAIN_ID } from '../../constants/constants';
import { EnvironmentService } from '../../environment/environment-service';

type AuthBundle = {
  wallet: Wallet;
  credentials: ApiKeyCreds;
};

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  public readonly authBundle$ = new ReplaySubject<AuthBundle>(1);

  constructor(private readonly environmentService: EnvironmentService) {}

  public async onModuleInit() {
    this.logger.debug('Initializing api key...');
    const { privateKey } = this.environmentService.environment;
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

    const wallet = new Wallet(formattedKey);
    this.logger.debug(`    Wallet address: ${wallet.address}`);

    const tempClient = new ClobClient(CLOB_API_BASE, POLYGON_CHAIN_ID, wallet);
    const credentials = await tempClient.createOrDeriveApiKey();
    this.logger.debug('API credentials created.');

    this.authBundle$.next({ wallet, credentials });
  }
}
