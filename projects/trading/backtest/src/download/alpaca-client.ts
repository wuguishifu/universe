import { z } from 'zod';

import { setTimeout as sleep } from 'node:timers/promises';

import {
  AlpacaBar,
  alpacaBarSchema,
  alpacaCalendarDaySchema,
} from '../data/alpaca';

const DATA_URL = 'https://data.alpaca.markets';

export type DailyAdjustment = 'all' | 'raw';

const barsPageSchema = z.object({
  bars: z.record(z.string(), z.array(alpacaBarSchema)).nullish(),
  next_page_token: z.string().nullish(),
});

export type AlpacaCredentials = {
  keyId: string;
  secretKey: string;
  /** Trading API base, for the calendar. Paper keys only work against the paper URL. */
  tradingUrl: string;
};

/** The few Alpaca endpoints the downloader needs, throttled under the free plan's 200 requests a minute. */
export class AlpacaClient {
  private readonly credentials: AlpacaCredentials;
  private readonly minIntervalMs: number;
  private lastRequest = 0;

  constructor(credentials: AlpacaCredentials, minIntervalMs = 350) {
    this.credentials = credentials;
    this.minIntervalMs = minIntervalMs;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AlpacaClient {
    const keyId = env['APCA_API_KEY_ID'];
    const secretKey = env['APCA_API_SECRET_KEY'];
    if (!keyId || !secretKey) {
      throw new Error(
        'Set APCA_API_KEY_ID and APCA_API_SECRET_KEY (a .env in projects/trading/backtest works)',
      );
    }
    const tradingUrl =
      env['APCA_API_BASE_URL'] ?? 'https://paper-api.alpaca.markets';
    return new AlpacaClient({ keyId, secretKey, tradingUrl });
  }

  async calendar(start: string, end: string) {
    const url = new URL('/v2/calendar', this.credentials.tradingUrl);
    url.search = new URLSearchParams({ start, end }).toString();
    return z.array(alpacaCalendarDaySchema).parse(await this.get(url));
  }

  /** 1-minute SIP bars for one stock. */
  async stockBars(
    symbol: string,
    start: string,
    end: string,
  ): Promise<AlpacaBar[]> {
    const bars = await this.paginate('/v2/stocks/bars', {
      symbols: symbol,
      timeframe: '1Min',
      start,
      end,
      adjustment: 'raw',
      feed: 'sip',
      limit: '10000',
      sort: 'asc',
    });
    return bars[symbol] ?? [];
  }

  /** 1-minute SIP bars for up to 100 stocks over one window. Symbols with no bars are left out. */
  stockBarsMany(
    symbols: readonly string[],
    start: string,
    end: string,
  ): Promise<Record<string, AlpacaBar[]>> {
    return this.paginate('/v2/stocks/bars', {
      symbols: symbols.join(','),
      timeframe: '1Min',
      start,
      end,
      adjustment: 'raw',
      feed: 'sip',
      limit: '10000',
      sort: 'asc',
    });
  }

  /**
   * Daily SIP bars for up to 100 stocks. `all` adjusts for splits and dividends, so returns include
   * both; `raw` gives the prices that actually traded. Symbols with no bars are left out.
   */
  dailyBars(
    symbols: readonly string[],
    start: string,
    end: string,
    adjustment: DailyAdjustment = 'all',
  ): Promise<Record<string, AlpacaBar[]>> {
    return this.paginate('/v2/stocks/bars', {
      symbols: symbols.join(','),
      timeframe: '1Day',
      start,
      end,
      adjustment,
      feed: 'sip',
      limit: '10000',
      sort: 'asc',
    });
  }

  /** 1-minute bars for up to 100 option symbols. Symbols with no trades are left out. */
  optionBars(symbols: readonly string[], start: string, end: string) {
    return this.paginate('/v1beta1/options/bars', {
      symbols: symbols.join(','),
      timeframe: '1Min',
      start,
      end,
      limit: '10000',
      sort: 'asc',
    });
  }

  private async paginate(path: string, params: Record<string, string>) {
    const merged: Record<string, AlpacaBar[]> = {};
    let pageToken: string | undefined;
    do {
      const url = new URL(path, DATA_URL);
      url.search = new URLSearchParams({
        ...params,
        ...(pageToken ? { page_token: pageToken } : {}),
      }).toString();
      const page = barsPageSchema.parse(await this.get(url));
      for (const [symbol, bars] of Object.entries(page.bars ?? {})) {
        (merged[symbol] ??= []).push(...bars);
      }
      pageToken = page.next_page_token ?? undefined;
    } while (pageToken);
    return merged;
  }

  private async get(url: URL, attempt = 0): Promise<unknown> {
    const wait = this.lastRequest + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();

    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.credentials.keyId,
        'APCA-API-SECRET-KEY': this.credentials.secretKey,
      },
    });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 5) {
      await sleep(1000 * 2 ** attempt);
      return this.get(url, attempt + 1);
    }
    const body = await response.text();
    throw new Error(
      `${response.status} from ${url.pathname}: ${body.slice(0, 500)}`,
    );
  }
}
