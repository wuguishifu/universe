import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { nyTime } from '@projects/trading-core';

import { BacktestResult } from '../sim/backtest';

import { BacktestStats } from './stats';

const usd = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (n: number): string => (n > 0 ? `+${usd(n)}` : usd(n));
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** `2026-11-16 09:45`, New York time. */
export function nyLabel(time: number): string {
  const { date, minute } = nyTime(time);
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function table(rows: ReadonlyArray<readonly string[]>): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach(
      (cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)),
    );
  }
  return rows.map((row) =>
    row
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
      )
      .join('  '),
  );
}

export function formatSummary(
  name: string,
  result: BacktestResult,
  stats: BacktestStats,
): string {
  const lines = [
    `${name}: ${result.from} → ${result.to} (${stats.tradingDays} trading days)`,
    '',
    ...table([
      ['Net P&L', `${signedUsd(stats.netPnl)} (${pct(stats.returnPct)})`],
      ['Ending equity', usd(stats.endingEquity)],
      [
        'Max drawdown',
        `${usd(stats.maxDrawdown)} (${pct(stats.maxDrawdownPct)})`,
      ],
      ['Fees', usd(stats.fees)],
      [
        'Trades',
        `${stats.trades} (${stats.wins} won, ${stats.losses} lost, ${pct(stats.winRate)})`,
      ],
      ['Avg win / loss', `${usd(stats.avgWin)} / ${usd(stats.avgLoss)}`],
      [
        'Largest win / loss',
        `${usd(stats.largestWin)} / ${usd(stats.largestLoss)}`,
      ],
      [
        'Profit factor',
        Number.isFinite(stats.profitFactor)
          ? stats.profitFactor.toFixed(2)
          : '∞',
      ],
      [
        'Expectancy',
        `${signedUsd(stats.expectancy)} per trade (${pct(stats.avgPnlPct)} of premium)`,
      ],
      [
        't-stat',
        `${stats.tStat.toFixed(2)} (under 2 is indistinguishable from luck)`,
      ],
      ['Days up / down', `${stats.winningDays} / ${stats.losingDays}`],
      [
        'Best / worst day',
        `${signedUsd(stats.bestDay)} / ${signedUsd(stats.worstDay)}`,
      ],
    ]),
  ];

  const breakdownRows = (title: string, groups: BacktestStats['byReason']) => {
    const entries = Object.entries(groups).sort(
      (a, b) => b[1].trades - a[1].trades,
    );
    if (entries.length === 0) return [];
    return [
      '',
      ...table([
        [title, 'trades', 'win rate', 'net P&L'],
        ...entries.map(([key, g]) => [
          key,
          String(g.trades),
          pct(g.winRate),
          signedUsd(g.netPnl),
        ]),
      ]),
    ];
  };
  lines.push(...breakdownRows('Exit reason', stats.byReason));
  lines.push(...breakdownRows('Direction', stats.byDirection));
  if (Object.keys(stats.byTicker).length > 1)
    lines.push(...breakdownRows('Ticker', stats.byTicker));

  const skips = Object.entries(stats.skipped).sort((a, b) => b[1] - a[1]);
  lines.push('', `${stats.signals} signals, ${stats.trades} trades`);
  if (skips.length > 0) {
    lines.push(
      ...table([
        ['Skipped because', 'count'],
        ...skips.map(([reason, n]) => [reason, String(n)]),
      ]),
    );
  }

  if (result.warnings.length > 0) {
    const shown = result.warnings.slice(0, 10);
    lines.push(
      '',
      `Warnings (${result.warnings.length}):`,
      ...shown.map((w) => `  ${w}`),
    );
    if (result.warnings.length > shown.length)
      lines.push(`  …and ${result.warnings.length - shown.length} more`);
  }
  return lines.join('\n');
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';

/**
 * Writes a run's files to `dir`:
 * config.json (everything needed to reproduce it), summary.json, trades.csv, days.csv,
 * equity.csv and events.jsonl (signals, skips, orders and fills).
 */
export function writeRun(
  dir: string,
  name: string,
  result: BacktestResult,
  stats: BacktestStats,
): void {
  mkdirSync(dir, { recursive: true });
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

  writeFileSync(
    join(dir, 'config.json'),
    json({
      name,
      from: result.from,
      to: result.to,
      strategy: result.strategy,
      simulation: result.simulation,
    }),
  );
  writeFileSync(join(dir, 'summary.json'), json(stats));
  writeFileSync(
    join(dir, 'trades.csv'),
    csv(
      [
        'entry',
        'exit',
        'ticker',
        'direction',
        'symbol',
        'qty',
        'entry_price',
        'exit_price',
        'reason',
        'pnl',
        'fees',
        'net_pnl',
        'pnl_pct',
      ],
      result.trades.map((t) => [
        nyLabel(t.entryTime),
        nyLabel(t.exitTime),
        t.ticker,
        t.direction,
        t.symbol,
        t.qty,
        t.entryPrice,
        t.exitPrice,
        t.reason,
        t.pnl.toFixed(2),
        t.fees.toFixed(2),
        t.netPnl.toFixed(2),
        t.pnlPct.toFixed(4),
      ]),
    ),
  );
  writeFileSync(
    join(dir, 'days.csv'),
    csv(
      ['date', 'trades', 'net_pnl', 'equity'],
      result.days.map((d) => [
        d.date,
        d.trades,
        d.netPnl.toFixed(2),
        d.equity.toFixed(2),
      ]),
    ),
  );
  writeFileSync(
    join(dir, 'equity.csv'),
    csv(
      ['time', 'equity'],
      result.equity.map((p) => [nyLabel(p.time), p.equity.toFixed(2)]),
    ),
  );
  writeFileSync(
    join(dir, 'events.jsonl'),
    result.events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}
