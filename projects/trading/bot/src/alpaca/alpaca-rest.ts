import { z } from 'zod';

import { setTimeout as sleep } from 'node:timers/promises';

import { Bar, CalendarDay } from '@projects/trading-core';

import {
  AccountInfo,
  Broker,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerPosition,
  Log,
  MarketData,
  OptionChainRequest,
  OptionQuoteSnapshot,
  OptionsFeed,
  OrderRejectedError,
  StockFeed,
} from '../host/ports';

import {
  alpacaAccountSchema,
  alpacaOrderSchema,
  alpacaPositionSchema,
  barsPageSchema,
  calendarDaySchema,
  latestQuotesSchema,
  snapshotsPageSchema,
  toAccountInfo,
  toBar,
  toBrokerOrder,
  toBrokerPosition,
  toOptionQuote,
} from './schemas';

export const PAPER_TRADING_URL = 'https://paper-api.alpaca.markets';

export type AlpacaConfig = {
  keyId: string;
  secretKey: string;
  tradingUrl: string;
  dataUrl: string;
  stockFeed: StockFeed;
  optionsFeed: OptionsFeed;
  /** Spacing between requests. Alpaca's free plan allows 200 a minute; paid plans far more. */
  minIntervalMs: number;
};

/**
 * Refuses anything but Alpaca's paper environment. The bot is a forward paper test; pointing it at
 * a live account takes a code change, on purpose.
 */
export function assertPaper(
  config: Pick<AlpacaConfig, 'keyId' | 'tradingUrl'>,
): void {
  const host = new URL(config.tradingUrl).host;
  if (host !== new URL(PAPER_TRADING_URL).host)
    throw new Error(
      `Refusing to trade against ${host}: only ${PAPER_TRADING_URL} is allowed`,
    );
  if (!config.keyId.startsWith('PK'))
    throw new Error(
      'Refusing to start: the API key is not a paper key (paper keys start with PK)',
    );
}

class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`${status} from ${path}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

/** Alpaca's trading and market data REST APIs, as the host's `Broker` and `MarketData`. */
export class AlpacaRest implements Broker, MarketData {
  private readonly config: AlpacaConfig;
  private readonly log: Log;
  private lastRequest = 0;

  constructor(config: AlpacaConfig, log: Log) {
    assertPaper(config);
    this.config = config;
    this.log = log;
  }

  // --- broker --------------------------------------------------------------------------------

  async submitOrder(request: BrokerOrderRequest): Promise<BrokerOrder> {
    const body = {
      symbol: request.symbol,
      qty: String(request.qty),
      side: request.side,
      type: request.type,
      time_in_force: 'day',
      client_order_id: request.clientOrderId,
      ...(request.type === 'limit'
        ? { limit_price: String(request.limitPrice) }
        : {}),
    };
    try {
      return toBrokerOrder(
        alpacaOrderSchema.parse(
          await this.request('POST', this.trading('/v2/orders'), body, false),
        ),
      );
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status >= 400 &&
        error.status < 500
      )
        throw new OrderRejectedError(error.status, error.body);
      // The request may or may not have landed. The client order id says which.
      const existing = await this.findByClientOrderId(request.clientOrderId);
      if (existing) return existing;
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request('DELETE', this.trading(`/v2/orders/${orderId}`));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    return toBrokerOrder(
      alpacaOrderSchema.parse(
        await this.request('GET', this.trading(`/v2/orders/${orderId}`)),
      ),
    );
  }

  async listOpenOrders(): Promise<BrokerOrder[]> {
    const url = this.trading('/v2/orders');
    url.search = new URLSearchParams({
      status: 'open',
      limit: '500',
      nested: 'false',
    }).toString();
    return z
      .array(alpacaOrderSchema)
      .parse(await this.request('GET', url))
      .map(toBrokerOrder);
  }

  async listPositions(): Promise<BrokerPosition[]> {
    return z
      .array(alpacaPositionSchema)
      .parse(await this.request('GET', this.trading('/v2/positions')))
      .map(toBrokerPosition);
  }

  async getAccount(): Promise<AccountInfo> {
    return toAccountInfo(
      alpacaAccountSchema.parse(
        await this.request('GET', this.trading('/v2/account')),
      ),
    );
  }

  private async findByClientOrderId(
    clientOrderId: string,
  ): Promise<BrokerOrder | undefined> {
    const url = this.trading('/v2/orders:by_client_order_id');
    url.search = new URLSearchParams({
      client_order_id: clientOrderId,
    }).toString();
    try {
      return toBrokerOrder(
        alpacaOrderSchema.parse(await this.request('GET', url)),
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  // --- market data ---------------------------------------------------------------------------

  async calendar(start: string, end: string): Promise<CalendarDay[]> {
    const url = this.trading('/v2/calendar');
    url.search = new URLSearchParams({ start, end }).toString();
    return z.array(calendarDaySchema).parse(await this.request('GET', url));
  }

  async stockBars(ticker: string, start: number, end: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    let pageToken: string | undefined;
    do {
      const url = this.data('/v2/stocks/bars');
      url.search = new URLSearchParams({
        symbols: ticker,
        timeframe: '1Min',
        start: new Date(start).toISOString(),
        // Alpaca's end is inclusive; ours isn't.
        end: new Date(end - 1).toISOString(),
        adjustment: 'raw',
        feed: this.config.stockFeed,
        limit: '10000',
        sort: 'asc',
        ...(pageToken ? { page_token: pageToken } : {}),
      }).toString();
      const page = barsPageSchema.parse(await this.request('GET', url));
      for (const bar of page.bars?.[ticker] ?? []) bars.push(toBar(bar));
      pageToken = page.next_page_token ?? undefined;
    } while (pageToken);
    return bars.filter((bar) => bar.time >= start && bar.time < end);
  }

  async optionChain(
    request: OptionChainRequest,
  ): Promise<OptionQuoteSnapshot[]> {
    const quotes: OptionQuoteSnapshot[] = [];
    let pageToken: string | undefined;
    do {
      const url = this.data(`/v1beta1/options/snapshots/${request.underlying}`);
      url.search = new URLSearchParams({
        feed: this.config.optionsFeed,
        type: request.type,
        expiration_date_gte: request.expirationFrom,
        expiration_date_lte: request.expirationTo,
        strike_price_gte: String(request.strikeFrom),
        strike_price_lte: String(request.strikeTo),
        limit: '1000',
        ...(pageToken ? { page_token: pageToken } : {}),
      }).toString();
      const page = snapshotsPageSchema.parse(await this.request('GET', url));
      for (const [symbol, snapshot] of Object.entries(page.snapshots ?? {})) {
        if (snapshot.latestQuote)
          quotes.push(toOptionQuote(symbol, snapshot.latestQuote));
      }
      pageToken = page.next_page_token ?? undefined;
    } while (pageToken);
    return quotes;
  }

  async latestOptionQuotes(
    symbols: readonly string[],
  ): Promise<OptionQuoteSnapshot[]> {
    if (symbols.length === 0) return [];
    const url = this.data('/v1beta1/options/quotes/latest');
    url.search = new URLSearchParams({
      symbols: symbols.join(','),
      feed: this.config.optionsFeed,
    }).toString();
    const page = latestQuotesSchema.parse(await this.request('GET', url));
    return Object.entries(page.quotes ?? {}).map(([symbol, quote]) =>
      toOptionQuote(symbol, quote),
    );
  }

  // --- http ----------------------------------------------------------------------------------

  private trading(path: string): URL {
    return new URL(path, this.config.tradingUrl);
  }

  private data(path: string): URL {
    return new URL(path, this.config.dataUrl);
  }

  /** `retry` is off for order submission, which has its own recovery. */
  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    url: URL,
    body?: unknown,
    retry = true,
    attempt = 0,
  ): Promise<unknown> {
    const wait = this.lastRequest + this.config.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'APCA-API-KEY-ID': this.config.keyId,
          'APCA-API-SECRET-KEY': this.config.secretKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (retry && attempt < 4) {
        this.log.warn('request failed; retrying', {
          method,
          path: url.pathname,
          error: String(error),
        });
        await sleep(500 * 2 ** attempt);
        return this.request(method, url, body, retry, attempt + 1);
      }
      throw error;
    }
    if (response.ok) {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (retry && retryable && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return this.request(method, url, body, retry, attempt + 1);
    }
    throw new HttpError(response.status, url.pathname, await response.text());
  }
}
