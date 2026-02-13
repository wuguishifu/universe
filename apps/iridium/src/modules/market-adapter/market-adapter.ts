import { Logger } from '@nestjs/common';

import { HttpService } from '@wuguishifu/nest-common';

import { GAMMA_API_BASE } from '../../constants/constants';
import { Market } from '../../types/market';

export abstract class MarketAdapter {
  protected readonly httpService = new HttpService({ baseURL: GAMMA_API_BASE });
  protected abstract readonly logger: Logger;

  public abstract readonly refreshIntervalMs: number;
  public abstract minTimeRemainingMs: number;
  public abstract maxTimeRemainingMs: number;
  public abstract stopLossTimeoutMs: number | null; // falsy values = disabled

  abstract fetchMarkets(): Promise<Market[]>;
}
