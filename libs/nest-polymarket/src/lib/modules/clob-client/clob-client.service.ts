import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClobClient } from '@polymarket/clob-client';
import { CLOB_API_BASE, POLYGON_CHAIN_ID } from '@wuguishifu/utils-polymarket';
import { ReplaySubject } from 'rxjs';
import { z } from 'zod';

import { AuthService } from '../auth';

export const clobClientEnvironmentSchema = z
  .object({
    SIGNATURE_TYPE: z.coerce.number().min(0).max(2).default(1),
    FUNDER_ADDRESS: z.string().optional(),
  })
  .refine((data) => data.SIGNATURE_TYPE !== 1 || !!data.FUNDER_ADDRESS, {
    message: 'FUNDER_ADDRESS is required when SIGNATURE_TYPE is 1',
    path: ['FUNDER_ADDRESS'],
  });

@Injectable()
export class ClobClientService implements OnModuleInit {
  private readonly logger = new Logger(ClobClientService.name);
  public readonly clobClient$ = new ReplaySubject<ClobClient>(1);

  constructor(private readonly authService: AuthService) {}

  public onModuleInit() {
    const { SIGNATURE_TYPE, FUNDER_ADDRESS } = clobClientEnvironmentSchema.parse(process.env);

    this.authService.authBundle$.subscribe(({ wallet, credentials }) => {
      this.logger.debug(`Initializing Polymarket CLOB client...`);
      this.clobClient$.next(
        new ClobClient(CLOB_API_BASE, POLYGON_CHAIN_ID, wallet, credentials, SIGNATURE_TYPE, FUNDER_ADDRESS),
      );
    });
  }
}
