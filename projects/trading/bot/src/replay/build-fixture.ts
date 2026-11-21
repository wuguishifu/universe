/**
 * Builds the replay test's fixture from the backtester's data directory:
 *
 *   nx run trading-bot:replay-fixture
 *
 * For each window it runs `backtest run --config configs/premarket-box-qqq.json --from --to` (the
 * real CLI, in a child process) and keeps its events as the expected decisions. Then it copies the
 * QQQ bars for the window and its warmup days, and the option quotes the replay reads: the chain
 * around each signal, and every quote of the contracts the backtest traded while it held them.
 */
import { z } from 'zod';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { EngineEvent, MINUTE_MS, nyTime } from '@projects/trading-core';

import { alpacaBarSchema, calendarDaySchema } from '../alpaca/schemas';
import { addDays } from '../host/ny-clock';
import { parseOccSymbol } from '../host/occ';

import {
  BarRow,
  engineEventSchema,
  QuoteRow,
  quoteRowSchema,
  ReplayFixture,
} from './fixture';

const { values } = parseArgs({
  options: {
    backtest: { type: 'string', default: '../backtest' },
    config: { type: 'string', default: 'configs/premarket-box-qqq.json' },
    windows: {
      type: 'string',
      default: '2025-11-24:2025-12-02,2025-07-01:2025-07-03',
    },
    out: {
      type: 'string',
      default: 'src/replay/fixtures/premarket-box-qqq.json.gz',
    },
    warmupDays: { type: 'string', default: '15' },
  },
});

const backtestDir = resolve(values.backtest);
const dataDir = join(backtestDir, 'data');
const ticker = 'QQQ';
const warmupDays = Number(values.warmupDays);
/** Strikes kept either side of the underlying around a decision. */
const STRIKE_PAD = 11;
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));

const calendar = z
  .array(calendarDaySchema)
  .parse(readJson(join(dataDir, 'calendar.json')))
  .sort((a, b) => a.date.localeCompare(b.date));
const tradingDays = calendar.map((day) => day.date);

const windows = values.windows.split(',').map((spec) => {
  const [from = '', to = ''] = spec.split(':');
  return { from, to };
});

function runBacktest(from: string, to: string): EngineEvent[] {
  const out = mkdtempSync(join(tmpdir(), 'replay-fixture-'));
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      '@swc-node/register/esm-register',
      'src/main.ts',
      'run',
      '--config',
      values.config,
      '--from',
      from,
      '--to',
      to,
      '--out',
      out,
    ],
    { cwd: backtestDir, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(`backtest failed:\n${result.stderr}\n${result.stdout}`);
  const [run] = readdirSync(out);
  if (!run) throw new Error('backtest wrote no run');
  return readFileSync(join(out, run, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => engineEventSchema.parse(JSON.parse(line)));
}

const bars: Record<string, BarRow[]> = {};
const quotes: Record<string, Record<string, QuoteRow[]>> = {};
const fixtureWindows: ReplayFixture['windows'] = [];

for (const window of windows) {
  const expected = runBacktest(window.from, window.to);
  fixtureWindows.push({ ...window, expected });
  process.stdout.write(
    `${window.from}..${window.to}: ${expected.length} events\n`,
  );

  const firstIndex = tradingDays.indexOf(window.from);
  const lastIndex = tradingDays.indexOf(window.to);
  if (firstIndex < 0 || lastIndex < 0)
    throw new Error(
      `Window ${window.from}..${window.to} is not on trading days`,
    );
  for (const date of tradingDays.slice(
    Math.max(0, firstIndex - warmupDays),
    lastIndex + 1,
  )) {
    const rows = z
      .array(alpacaBarSchema)
      .parse(readJson(join(dataDir, 'stocks', ticker, `${date}.json`)));
    bars[date] = rows.map((b) => [Date.parse(b.t), b.o, b.h, b.l, b.c, b.v]);
  }

  for (const date of tradingDays.slice(firstIndex, lastIndex + 1)) {
    const onDay = expected.filter((e) => eventDate(e) === date);
    const decisionTimes = onDay.flatMap((e) =>
      e.type === 'signal' ? [e.time] : [],
    );
    const held = new Map<string, { from: number; to: number }>();
    for (const event of onDay) {
      if (event.type !== 'order') continue;
      const span = held.get(event.order.symbol) ?? {
        from: event.order.time,
        to: event.order.time,
      };
      span.from = Math.min(span.from, event.order.time);
      span.to = Math.max(span.to, event.order.time);
      held.set(event.order.symbol, span);
    }
    const day = z
      .record(z.string(), z.array(quoteRowSchema))
      .parse(readJson(join(dataDir, 'quotes', ticker, `${date}.json`)));
    const dayBars = bars[date] ?? [];
    const kept: Record<string, QuoteRow[]> = {};

    for (const [symbol, rows] of Object.entries(day)) {
      const occ = parseOccSymbol(symbol);
      if (!occ || occ.expiration < date || occ.expiration > addDays(date, 7))
        continue;
      const spans: Array<{ from: number; to: number }> = [];
      for (const time of decisionTimes) {
        const spot = closeBefore(dayBars, time);
        if (spot !== undefined && Math.abs(occ.strike - spot) <= STRIKE_PAD)
          spans.push({ from: time - 3 * MINUTE_MS, to: time + 2 * MINUTE_MS });
      }
      const traded = held.get(symbol);
      if (traded)
        spans.push({
          from: traded.from - 3 * MINUTE_MS,
          to: traded.to + 2 * MINUTE_MS,
        });
      if (spans.length === 0) continue;
      kept[symbol] = trimRows(rows, spans);
    }
    quotes[date] = kept;
  }
}

const earliest = Object.keys(bars).sort()[0] ?? '';
const latest = Object.keys(bars).sort().at(-1) ?? '';
const fixture: ReplayFixture = {
  description:
    'QQQ 1-minute SIP bars and Theta Data NBBO option quotes for the replay test, with the decisions of `backtest run` on each window.',
  generatedAt: new Date().toISOString(),
  config: values.config,
  windows: fixtureWindows,
  ticker,
  calendar: calendar.filter(
    (d) => d.date >= addDays(earliest, -90) && d.date <= addDays(latest, 30),
  ),
  bars,
  quotes,
};
const json = JSON.stringify(fixture);
writeFileSync(values.out, gzipSync(json, { level: 9 }));
process.stdout.write(
  `Wrote ${values.out}: ${Object.keys(bars).length} days of bars, ${Object.values(quotes).reduce((n, d) => n + Object.keys(d).length, 0)} contracts of quotes, ${(json.length / 1e6).toFixed(1)} MB before gzip\n`,
);

function eventDate(event: EngineEvent): string | undefined {
  switch (event.type) {
    case 'signal':
    case 'entrySkipped':
      return nyTime(event.time).date;
    case 'order':
      return nyTime(event.order.time).date;
    case 'positionOpened':
      return nyTime(event.position.entryTime).date;
    case 'positionClosed':
      return nyTime(event.trade.exitTime).date;
    default:
      return undefined;
  }
}

/** Close of the last 1-minute bar that ended by `time`. */
function closeBefore(
  rows: readonly BarRow[],
  time: number,
): number | undefined {
  let close: number | undefined;
  for (const row of rows) {
    if (row[0] + MINUTE_MS > time) break;
    close = row[4];
  }
  return close;
}

/** Rows inside any span, plus the row standing when each span starts. */
function trimRows(
  rows: readonly QuoteRow[],
  spans: ReadonlyArray<{ from: number; to: number }>,
): QuoteRow[] {
  const keep = new Set<number>();
  for (const span of spans) {
    let standing = -1;
    rows.forEach((row, i) => {
      if (row[0] <= span.from) standing = i;
      else if (row[0] <= span.to) keep.add(i);
    });
    if (standing >= 0) keep.add(standing);
  }
  return [...keep]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const row = rows[i];
      return row ? [row] : [];
    });
}
