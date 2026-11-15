import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Bar } from '@projects/trading-core';

import { parseOccSymbol } from '../data/alpaca';
import { DataStore } from '../data/data-store';
import { QuoteCollector, QuoteFile } from '../data/theta';

import { addDays } from './download';
import { OptionQuoteRequest, ThetaClient } from './theta-client';

export type QuoteDownloadOptions = {
  client: Pick<ThetaClient, 'optionQuotes'>;
  dir: string;
  tickers: readonly string[];
  /** First and last trading day, `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  /** Option expirations from 0 up to this many calendar days out. */
  expiryDays: number;
  /** Strikes from this far below the day's low to this far above its high. */
  strikePadding: number;
  /** The smallest gap between listed strikes, for sizing the request. */
  strikeStep: number;
  /**
   * Ask Theta Data for only the strikes near the money, which makes responses several times
   * smaller. Turn it off if the coverage numbers in the log come out low.
   */
  narrowRequest: boolean;
  /** Ticker-days fetched at once. Theta Data allows 2 on Value, 4 on Standard and 8 on Pro. */
  concurrency: number;
  log: (line: string) => void;
};

/** The strikes to keep for a day whose underlying traded between `low` and `high`. */
export function strikeWindow(
  range: { low: number; high: number },
  padding: number,
): { minStrike: number; maxStrike: number } {
  return {
    minStrike: Math.floor(range.low - padding),
    maxStrike: Math.ceil(range.high + padding),
  };
}

/**
 * How many strikes either side of the underlying's price cover the window. Theta Data doesn't say
 * which price of the day it counts from, so this assumes the worst: the far end of the day's range.
 */
export function strikesEitherSide(
  range: { low: number; high: number },
  padding: number,
  step: number,
): number {
  return Math.ceil((range.high - range.low + padding) / step) + 2;
}

/** The underlying's range over the regular session and extended hours, as the bar download uses. */
const rangeOf = (bars: readonly Bar[]): { low: number; high: number } => ({
  low: Math.min(...bars.map((bar) => bar.low)),
  high: Math.max(...bars.map((bar) => bar.high)),
});

/** Of the contracts that traded, how many have at least one quote. */
export function coverage(
  traded: Iterable<string>,
  quotes: QuoteFile,
): { traded: number; quoted: number } {
  let count = 0;
  let quoted = 0;
  for (const symbol of traded) {
    count += 1;
    if ((quotes[symbol]?.length ?? 0) > 0) quoted += 1;
  }
  return { traded: count, quoted };
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/**
 * Fills `quotes/<TICKER>/<DATE>.json` with 1-minute bid/ask history from Theta Data, for the same
 * contracts the option bar download covers. It needs the stock bars on disk already, to know each
 * day's range. Days already on disk are skipped, so it can resume.
 */
export async function downloadQuotes(
  options: QuoteDownloadOptions,
): Promise<void> {
  const { client, dir, tickers, from, to, log } = options;
  const store = new DataStore(dir);
  const calendar = store.calendar();
  const hours = new Map(calendar.map((day) => [day.date, day]));
  const days = calendar
    .map((day) => day.date)
    .filter((date) => date >= from && date <= to);

  const jobs: Array<{ ticker: string; date: string }> = [];
  for (const date of days) {
    for (const ticker of tickers) {
      if (!existsSync(DataStore.quotePath(dir, ticker, date)))
        jobs.push({ ticker, date });
    }
  }
  log(
    `${jobs.length} ticker-days to fetch (${days.length * tickers.length - jobs.length} already on disk)`,
  );

  let next = 0;
  let done = 0;
  const totals = { traded: 0, quoted: 0, empty: 0 };
  const worker = async (): Promise<void> => {
    for (let job = jobs[next++]; job; job = jobs[next++]) {
      const { ticker, date } = job;
      const stock = store.stockBars(ticker, date) ?? [];
      const session = hours.get(date);
      if (stock.length === 0 || !session) {
        log(`${date} ${ticker}: no stock bars, skipping (run download first)`);
        continue;
      }
      const range = rangeOf(stock);
      const window = strikeWindow(range, options.strikePadding);
      const request: OptionQuoteRequest = {
        symbol: ticker,
        date,
        maxDte: options.expiryDays,
        startTime: `${session.open}:00`,
        endTime: `${session.close}:00`,
        ...(options.narrowRequest
          ? {
              strikeRange: strikesEitherSide(
                range,
                options.strikePadding,
                options.strikeStep,
              ),
            }
          : {}),
      };

      let collector = new QuoteCollector({
        ...window,
        maxExpiration: addDays(date, options.expiryDays),
      });
      const found = await client.optionQuotes(
        request,
        () => {
          collector = new QuoteCollector({
            ...window,
            maxExpiration: addDays(date, options.expiryDays),
          });
        },
        (line) => collector.push(line),
      );
      done += 1;
      if (!found) {
        // Not written, so a later run asks again: "no data" on a trading day is more likely a
        // gap in the account's history than a day with no quotes.
        totals.empty += 1;
        log(`${date} ${ticker}: Theta Data has no quotes`);
        continue;
      }

      const quotes = collector.result();
      writeJsonAtomic(DataStore.quotePath(dir, ticker, date), quotes);

      // Only contracts the quote download is meant to cover count against it.
      const traded = [...(store.optionBars(ticker, date)?.keys() ?? [])].filter(
        (symbol) => {
          const contract = parseOccSymbol(symbol);
          return (
            contract !== null &&
            contract.strike >= window.minStrike &&
            contract.strike <= window.maxStrike
          );
        },
      );
      const covered = coverage(traded, quotes);
      totals.traded += covered.traded;
      totals.quoted += covered.quoted;
      const changes = Object.values(quotes).reduce(
        (sum, rows) => sum + rows.length,
        0,
      );
      const malformed =
        collector.malformed > 0 ? `, ${collector.malformed} unreadable` : '';
      log(
        `${date} ${ticker}: ${Object.keys(quotes).length} contracts, ${changes} quote changes from ${collector.rows} rows${malformed}; quotes for ${covered.quoted} of ${covered.traded} traded contracts (${done}/${jobs.length})`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, worker),
  );

  if (totals.traded > 0) {
    const pct = ((100 * totals.quoted) / totals.traded).toFixed(1);
    log(
      `Quotes cover ${totals.quoted} of ${totals.traded} traded contracts (${pct}%).${
        totals.quoted < totals.traded * 0.98 && options.narrowRequest
          ? ' That is low: delete the affected days and rerun with --full-chain.'
          : ''
      }`,
    );
  }
  if (totals.empty > 0)
    log(`${totals.empty} ticker-days had no quotes at Theta Data.`);
}
