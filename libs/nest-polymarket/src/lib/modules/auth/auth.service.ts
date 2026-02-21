import { Wallet } from '@ethersproject/wallet';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiKeyCreds, ClobClient } from '@polymarket/clob-client';
import { CLOB_API_BASE, POLYGON_CHAIN_ID } from '@wuguishifu/utils-polymarket';
import { ReplaySubject } from 'rxjs';
import { z } from 'zod';

type AuthBundle = {
  wallet: Wallet;
  credentials: ApiKeyCreds;
};

export const authEnvironmentSchema = z.object({
  PRIVATE_KEY: z.string(),
});

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  public readonly authBundle$ = new ReplaySubject<AuthBundle>(1);

  public async onModuleInit() {
    const privateKey = authEnvironmentSchema.parse(process.env).PRIVATE_KEY;
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

    const wallet = new Wallet(formattedKey);
    this.logger.debug(`Wallet address: ${wallet.address}`);

    const tempClient = new ClobClient(CLOB_API_BASE, POLYGON_CHAIN_ID, wallet);
    const credentials = await tempClient.createOrDeriveApiKey();
    this.logger.debug('API credentials created.');
    this.authBundle$.next({ wallet, credentials });
  }
}
