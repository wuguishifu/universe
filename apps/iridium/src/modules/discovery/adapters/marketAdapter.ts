import { Logger } from '@nestjs/common';

import { HttpService } from '@wuguishifu/nest-common';

import { Market } from '../../../types/market';

export abstract class MarketAdapter {
  constructor(
    protected httpService: HttpService,
    protected logger: Logger,
  ) {}

  abstract fetchMarkets(): Promise<Market[]>;
}
