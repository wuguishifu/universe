import { Logger } from '@nestjs/common';

import { HttpService } from '@wuguishifu/nest-common';
import { GAMMA_API_BASE, Market } from '@wuguishifu/utils-polymarket';

export abstract class MarketAdapter {
  protected readonly httpService = new HttpService({ baseURL: GAMMA_API_BASE });
  protected abstract readonly logger: Logger;

  public abstract readonly refreshIntervalMs: number;

  abstract fetchMarkets(): Promise<Market[]>;
}
