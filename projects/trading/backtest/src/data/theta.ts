import { nyTime, OptionType } from '@projects/trading-core';

import { occSymbol } from './alpaca';

/**
 * One stored quote: `[time, bid, ask]`. `time` is epoch milliseconds, and the bid and ask are the
 * national best bid and offer that stood at that instant.
 *
 * Only changes are stored. A contract's quote at any time is its last row at or before that time.
 */
export type QuoteRow = [time: number, bid: number, ask: number];

/** A day of quotes for one underlying, by OCC symbol. Rows are sorted by time. */
export type QuoteFile = Record<string, QuoteRow[]>;

const HOUR_MS = 3_600_000;
const offsetByDate = new Map<string, number>();

/**
 * Theta Data timestamps are New York wall-clock time with no zone: `2024-11-04T09:30:00.000`.
 * Returns epoch milliseconds, or NaN if the text isn't a timestamp.
 */
export function nyLocalToEpoch(timestamp: string): number {
  const asUtc = Date.parse(`${timestamp}Z`);
  if (Number.isNaN(asUtc)) return Number.NaN;
  const date = timestamp.slice(0, 10);
  let offset = offsetByDate.get(date);
  if (offset === undefined) {
    // New York is 4 or 5 hours behind UTC. Noon is never near a clock change, so test there.
    const noon = Date.parse(`${date}T12:00:00Z`);
    offset = nyTime(noon + 4 * HOUR_MS).minute === 720 ? 4 : 5;
    offsetByDate.set(date, offset);
  }
  return asUtc + offset * HOUR_MS;
}

const optionTypeOf = (right: string): OptionType | null => {
  const first = right.trim().charAt(0).toUpperCase();
  if (first === 'C') return 'call';
  if (first === 'P') return 'put';
  return null;
};

export type QuoteFilter = {
  /** Keep strikes in this range, inclusive, in dollars. */
  minStrike: number;
  maxStrike: number;
  /** Keep expirations up to this date, `YYYY-MM-DD`, inclusive. */
  maxExpiration: string;
};

/**
 * Builds a `QuoteFile` from the lines of a Theta Data CSV response, one line at a time, so a
 * response of a million rows never has to be held as text.
 *
 * Columns are found by name from the header line, so their order doesn't matter.
 */
export class QuoteCollector {
  private readonly filter: QuoteFilter;
  private columns: Record<string, number> | undefined;
  private readonly quotes = new Map<string, QuoteRow[]>();
  /** Data lines read, kept or not. */
  rows = 0;
  /** Lines that couldn't be read as a quote. */
  malformed = 0;

  constructor(filter: QuoteFilter) {
    this.filter = filter;
  }

  push(line: string): void {
    const cells = line.split(',').map((cell) => cell.trim().replace(/"/g, ''));
    if (!this.columns) {
      this.columns = Object.fromEntries(
        cells.map((name, index) => [name.toLowerCase(), index]),
      );
      for (const name of REQUIRED_COLUMNS) {
        if (this.columns[name] === undefined) {
          throw new Error(
            `Theta Data response has no "${name}" column. Header was: ${line.slice(0, 300)}`,
          );
        }
      }
      return;
    }
    if (line.trim() === '') return;
    this.rows += 1;

    const cell = (name: string): string =>
      cells[this.columns?.[name] ?? -1] ?? '';
    const strike = Number(cell('strike'));
    const expiration = normalizeDate(cell('expiration'));
    const type = optionTypeOf(cell('right'));
    const time = nyLocalToEpoch(cell('timestamp'));
    const bid = Number(cell('bid'));
    const ask = Number(cell('ask'));
    if (
      !type ||
      !expiration ||
      !Number.isFinite(strike) ||
      !Number.isFinite(time) ||
      !Number.isFinite(bid) ||
      !Number.isFinite(ask)
    ) {
      this.malformed += 1;
      return;
    }
    // An ask of zero means nobody was quoting.
    if (ask <= 0 || bid < 0) return;
    const { minStrike, maxStrike, maxExpiration } = this.filter;
    if (strike < minStrike || strike > maxStrike || expiration > maxExpiration)
      return;

    const symbol = occSymbol({
      underlying: cell('symbol').toUpperCase(),
      expiration,
      type,
      strike,
    });
    let list = this.quotes.get(symbol);
    if (!list) {
      list = [];
      this.quotes.set(symbol, list);
    }
    const last = list.at(-1);
    if (last && last[1] === bid && last[2] === ask) return;
    list.push([time, bid, ask]);
  }

  /** Everything collected, with each contract's rows sorted by time. */
  result(): QuoteFile {
    const file: QuoteFile = {};
    for (const symbol of [...this.quotes.keys()].sort()) {
      const rows = this.quotes.get(symbol) ?? [];
      file[symbol] = dropRepeats(rows.sort((a, b) => a[0] - b[0]));
    }
    return file;
  }
}

const REQUIRED_COLUMNS = [
  'symbol',
  'expiration',
  'strike',
  'right',
  'timestamp',
  'bid',
  'ask',
];

/** `20241108` or `2024-11-08` → `2024-11-08`. */
function normalizeDate(text: string): string | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Rows that arrive out of order can leave repeats behind after sorting. */
function dropRepeats(rows: QuoteRow[]): QuoteRow[] {
  const kept: QuoteRow[] = [];
  for (const row of rows) {
    const last = kept.at(-1);
    if (last && last[1] === row[1] && last[2] === row[2]) continue;
    kept.push(row);
  }
  return kept;
}

/** A contract's quote at `time`: its last row at or before it. Rows must be sorted by time. */
export function quoteAt(
  rows: readonly QuoteRow[],
  time: number,
): QuoteRow | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let found: QuoteRow | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (!row) break;
    if (row[0] <= time) {
      found = row;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
