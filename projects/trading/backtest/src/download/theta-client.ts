import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_THETA_URL = 'http://127.0.0.1:25503';

/** Theta Data's own status codes, from its "Error Codes" page. */
const NO_DATA = 472;
/** Throttled, connection to its servers lost, and servers restarting: all worth another try. */
const RETRYABLE = new Set([429, 474, 571]);
const HINTS: Record<number, string> = {
  404: 'the Theta Terminal may be out of date',
  471: 'this account’s plan doesn’t include that data (1-minute option quotes need Value or higher, from 2020-01-01)',
  473: 'the request’s parameters were rejected; the Theta Terminal may be out of date',
  476: 'use the same host for every request; don’t mix 127.0.0.1 and localhost',
  478: 'more than one Theta Terminal may be running on this account',
};

export type OptionQuoteRequest = {
  symbol: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** Only contracts expiring within this many calendar days. */
  maxDte: number;
  /** Only this many strikes either side of the underlying's price, if set. */
  strikeRange?: number;
  /** New York times, `HH:MM:SS`. */
  startTime: string;
  endTime: string;
};

/**
 * The one Theta Data endpoint the downloader needs. Theta Data serves history through the Theta
 * Terminal, a program running on this machine that holds the account's login, so requests here
 * carry no credentials.
 */
export class ThetaClient {
  readonly baseUrl: string;

  constructor(baseUrl = DEFAULT_THETA_URL) {
    this.baseUrl = baseUrl;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ThetaClient {
    return new ThetaClient(env['THETA_URL'] ?? DEFAULT_THETA_URL);
  }

  /** The request for one underlying's 1-minute quotes on one day, every expiration at once. */
  optionQuotesUrl(request: OptionQuoteRequest): URL {
    const url = new URL('/v3/option/history/quote', this.baseUrl);
    const params: Record<string, string> = {
      symbol: request.symbol,
      expiration: '*',
      date: request.date.replaceAll('-', ''),
      interval: '1m',
      start_time: request.startTime,
      end_time: request.endTime,
      max_dte: String(request.maxDte),
      format: 'csv',
    };
    if (request.strikeRange !== undefined)
      params['strike_range'] = String(request.strikeRange);
    url.search = new URLSearchParams(params).toString();
    return url;
  }

  /**
   * Calls `onLine` with each line of the CSV response, header first. Returns false when Theta Data
   * has nothing for the request.
   *
   * A request that fails partway is started again from the top, so `begin` is called before each
   * attempt to let the caller throw away what it had.
   */
  async optionQuotes(
    request: OptionQuoteRequest,
    begin: () => void,
    onLine: (line: string) => void,
  ): Promise<boolean> {
    const url = this.optionQuotesUrl(request);
    for (let attempt = 0; ; attempt++) {
      begin();
      try {
        const response = await this.open(url);
        if (response.status === NO_DATA) return false;
        if (response.ok) {
          await readLines(response, onLine);
          return true;
        }
        if (!RETRYABLE.has(response.status) || attempt >= 6) {
          const body = (await response.text()).slice(0, 300);
          const hint = HINTS[response.status];
          throw new FatalError(
            `${response.status} from ${url.pathname}${url.search}: ${body}${hint ? ` (${hint})` : ''}`,
          );
        }
      } catch (error) {
        if (error instanceof FatalError || attempt >= 6) throw error;
      }
      await sleep(Math.min(60_000, 1000 * 2 ** attempt));
    }
  }

  private async open(url: URL): Promise<Response> {
    try {
      return await fetch(url);
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? cause.code
          : undefined;
      if (code === 'ECONNREFUSED') {
        throw new FatalError(
          `Nothing is listening at ${this.baseUrl}. Start the Theta Terminal first (see README, "Option quotes"), or set THETA_URL.`,
        );
      }
      throw error;
    }
  }
}

/** An error that trying again won't fix. */
class FatalError extends Error {}

async function readLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of response.body) {
    rest += decoder.decode(chunk, { stream: true });
    let end = rest.indexOf('\n');
    let start = 0;
    while (end !== -1) {
      onLine(rest.slice(start, end).replace(/\r$/, ''));
      start = end + 1;
      end = rest.indexOf('\n', start);
    }
    rest = rest.slice(start);
  }
  rest += decoder.decode();
  if (rest.trim() !== '') onLine(rest.replace(/\r$/, ''));
}
