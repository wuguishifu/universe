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
  public abstract stopLossMaxDropCents: number | null;
  public abstract stopLossGracePeriodMs: number | null;
  public abstract stopLossMinTimeRemainingMs: number | null;
  public abstract stopLossConfirmationDelayMs: number | null;
  public straddleCooldownMs = 300_000; // 5 minutes
  public tradingStartHourUtc: number | null = null; // null = no restriction
  public tradingEndHourUtc: number | null = null; // null = no restriction

  abstract fetchMarkets(): Promise<Market[]>;
}
