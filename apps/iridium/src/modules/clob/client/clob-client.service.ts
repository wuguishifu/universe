import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClobClient } from '@polymarket/clob-client';
import { ReplaySubject } from 'rxjs';

import { CLOB_API_BASE, POLYGON_CHAIN_ID } from '@wuguishifu/utils-polymarket';

import { EnvironmentService } from '../../../environment/environment-service';
import { AuthService } from '../../auth/auth.service';

@Injectable()
export class ClobClientService implements OnModuleInit {
  private readonly logger = new Logger(ClobClientService.name);
  public readonly clobClient$ = new ReplaySubject<ClobClient>(1);

  constructor(
    private readonly authService: AuthService,
    private readonly environmentService: EnvironmentService,
  ) {}

  public onModuleInit() {
    this.authService.authBundle$.subscribe(({ wallet, credentials }) => {
      this.logger.debug(`Initializing Polymarket CLOB client...`);
      this.clobClient$.next(
        new ClobClient(
          CLOB_API_BASE,
          POLYGON_CHAIN_ID,
          wallet,
          credentials,
          this.environmentService.environment.signatureType,
          this.environmentService.environment.funderAddress,
        ),
      );
    });
  }
}
