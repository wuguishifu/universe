import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { table } from '../report/report';

import { DailyResult } from './daily-backtest';
import { DailySuite } from './daily-config';
import { DailyStats } from './daily-stats';

export type DailyOutcome = {
  label: string;
  result: DailyResult;
  stats: DailyStats | null;
};

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function formatDailySuite(
  suite: DailySuite,
  outcomes: readonly DailyOutcome[],
): string {
  const years = [
    ...new Set(outcomes.flatMap((o) => Object.keys(o.stats?.byYear ?? {}))),
  ].sort();
  const rows = [
    [
      'Strategy',
      'CAGR',
      'Vol',
      'Sharpe',
      'Max DD',
      'Worst mo',
      'Cash',
      'Turnover/yr',
      'Costs',
      ...years,
    ],
    ...outcomes.map(({ label, stats }) =>
      stats
        ? [
            label,
            pct(stats.cagr),
            pct(stats.volatility),
            stats.sharpe.toFixed(2),
            pct(-stats.maxDrawdown),
            pct(stats.worstMonth),
            pct(stats.cashShare, 0),
            stats.turnoverPerYear.toFixed(1),
            `$${stats.costs.toFixed(0)}`,
            ...years.map((y) => {
              const r = stats.byYear[y];
              return r === undefined ? '' : pct(r, 0);
            }),
          ]
        : [label, 'never traded'],
    ),
  ];
  const first = outcomes.find((o) => o.stats)?.stats;
  return [
    `${suite.name}: ${first ? `${first.start} → ${first.end}` : 'no trades'}, ${suite.costBps} bp per side, Sharpe over ${suite.cash}`,
    '',
    ...table(rows),
  ].join('\n');
}

export function writeDailySuite(
  outDir: string,
  suite: DailySuite,
  outcomes: readonly DailyOutcome[],
): void {
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, body: string) =>
    writeFileSync(join(outDir, name), body);

  write('config.json', `${JSON.stringify(suite, null, 2)}\n`);
  write(
    'summary.json',
    `${JSON.stringify(
      Object.fromEntries(outcomes.map((o) => [o.label, o.stats])),
      null,
      2,
    )}\n`,
  );

  const dates = [
    ...new Set(outcomes.flatMap((o) => o.result.equity.map((p) => p.date))),
  ].sort();
  const values = outcomes.map(
    (o) => new Map(o.result.equity.map((p) => [p.date, p.value])),
  );
  write(
    'equity.csv',
    [
      ['date', ...outcomes.map((o) => o.label)].join(','),
      ...dates.map((date) =>
        [date, ...values.map((v) => v.get(date)?.toFixed(2) ?? '')].join(','),
      ),
    ].join('\n') + '\n',
  );

  write(
    'rebalances.csv',
    [
      'strategy,decided,traded,turnover,cost,weights',
      ...outcomes.flatMap((o) =>
        o.result.rebalances.map((r) =>
          [
            o.label,
            r.decided,
            r.traded,
            r.turnover.toFixed(4),
            r.cost.toFixed(2),
            Object.entries(r.weights)
              .map(([t, w]) => `${t}:${w.toFixed(3)}`)
              .join(' '),
          ].join(','),
        ),
      ),
    ].join('\n') + '\n',
  );
}
