import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DataStore } from '../data/data-store';
import {
  BacktestStats,
  finalizeStats,
  mergePartials,
  StatsPartial,
} from '../report/stats';

import { runInWorkers } from './pool';
import {
  Combo,
  describeChoices,
  expandCombos,
  SweepConfig,
} from './sweep-config';

export type SweepRow = {
  combo: Combo;
  train: BacktestStats | undefined;
  /** The training result for each calendar year in the range. */
  trainYears?: Record<string, BacktestStats>;
  test?: BacktestStats;
  error?: string;
  /** Other configs whose training results were identical, so the setting that differs didn't matter. */
  twins?: Combo[];
};

export type Marginal = {
  axis: string;
  label: string;
  configs: number;
  meanNetPnl: number;
  medianNetPnl: number;
  /** Share of this label's configs that made money on the training range. */
  profitable: number;
  meanTrades: number;
};

export type SweepOutcome = {
  rows: SweepRow[];
  /** Ranked training results, best first, limited to configs with enough trades. */
  ranked: SweepRow[];
  top: SweepRow[];
  marginals: Marginal[];
  invalid: string[];
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** How each label did on average across every config that used it. */
export function computeMarginals(
  config: SweepConfig,
  rows: readonly SweepRow[],
): Marginal[] {
  const marginals: Marginal[] = [];
  for (const [axis, values] of Object.entries(config.axes)) {
    for (const label of Object.keys(values)) {
      const stats = rows
        .filter((row) => row.combo.choices[axis] === label)
        .flatMap((row) => (row.train ? [row.train] : []));
      const pnls = stats.map((s) => s.netPnl);
      marginals.push({
        axis,
        label,
        configs: stats.length,
        meanNetPnl: pnls.reduce((a, b) => a + b, 0) / (pnls.length || 1),
        medianNetPnl: median(pnls),
        profitable: pnls.filter((p) => p > 0).length / (pnls.length || 1),
        meanTrades:
          stats.reduce((a, s) => a + s.trades, 0) / (stats.length || 1),
      });
    }
  }
  return marginals;
}

/** Identical training results almost always mean the configs traded identically. */
const fingerprint = (stats: BacktestStats): string =>
  [
    stats.trades,
    stats.netPnl.toFixed(2),
    stats.maxDrawdown.toFixed(2),
    stats.fees.toFixed(2),
  ].join('|');

/** The best `count` distinct results, each carrying the configs that tied with it exactly. */
export function distinctTop(
  ranked: readonly SweepRow[],
  count: number,
): SweepRow[] {
  const top: SweepRow[] = [];
  const byFingerprint = new Map<string, SweepRow>();
  for (const row of ranked) {
    if (!row.train) continue;
    const key = fingerprint(row.train);
    const first = byFingerprint.get(key);
    if (first) {
      (first.twins ??= []).push(row.combo);
    } else if (top.length < count) {
      const entry: SweepRow = { ...row };
      byFingerprint.set(key, entry);
      top.push(entry);
    } else {
      // Past the cutoff, only keep collecting twins for rows already shown.
      byFingerprint.set(key, { ...row });
    }
  }
  return top;
}

/** The axis labels where a row's twins differ from it, e.g. "onCross: exit-on-cross/hold". */
export function twinSummary(row: SweepRow): string {
  const twins = row.twins ?? [];
  if (twins.length === 0) return '';
  const differing = Object.keys(row.combo.choices).filter((axis) =>
    twins.some((twin) => twin.choices[axis] !== row.combo.choices[axis]),
  );
  return differing
    .map((axis) => {
      const labels = new Set([
        row.combo.choices[axis],
        ...twins.map((t) => t.choices[axis]),
      ]);
      return `${axis}: ${[...labels].join('/')}`;
    })
    .join(', ');
}

/**
 * Splits a range's trading days into back-to-back chunks of about `targetDays`, making the count
 * a multiple of `workers` so the work divides evenly. Chunks never span a new year, so results
 * can also be broken down by year.
 */
export function chunkRange(
  dates: readonly string[],
  range: { from: string; to: string },
  workers: number,
  targetDays: number,
): Array<{ from: string; to: string }> {
  const days = dates.filter((d) => d >= range.from && d <= range.to);
  if (days.length === 0) return [];
  const perWorker = Math.max(
    1,
    Math.round(days.length / (workers * targetDays)),
  );
  const count = Math.min(days.length, workers * perWorker);
  const chunks: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < count; i++) {
    const from = days[Math.floor((i * days.length) / count)];
    const to = days[Math.floor(((i + 1) * days.length) / count) - 1];
    if (from && to && from <= to) chunks.push(...splitAtYears(days, from, to));
  }
  return chunks;
}

function splitAtYears(
  days: readonly string[],
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  const inside = days.filter((d) => d >= from && d <= to);
  const pieces: Array<{ from: string; to: string }> = [];
  for (const day of inside) {
    const last = pieces.at(-1);
    if (last && last.from.slice(0, 4) === day.slice(0, 4)) last.to = day;
    else pieces.push({ from: day, to: day });
  }
  return pieces;
}

export async function runSweep(
  config: SweepConfig,
  options: { dataDir: string; workers: number; log: (line: string) => void },
): Promise<SweepOutcome> {
  const { combos, invalid } = expandCombos(config);
  options.log(
    `${combos.length} configs${invalid.length ? ` (${invalid.length} invalid, skipped)` : ''}`,
  );

  const progress = (phase: string, total: number) => {
    let lastShown = 0;
    return (done: number) => {
      const pct = Math.floor((done / total) * 10);
      if (pct > lastShown || done === total) {
        lastShown = pct;
        options.log(`  ${phase}: ${done}/${total}`);
      }
    };
  };

  const dates = new DataStore(options.dataDir)
    .calendar()
    .map((day) => day.date);

  /**
   * Runs every combo over a range, cut into back-to-back chunks with each chunk pinned to one
   * worker, then merges each combo's chunks into one result.
   */
  const evaluate = async (
    items: readonly Combo[],
    range: { from: string; to: string },
    phase: string,
  ): Promise<
    Array<{
      stats?: BacktestStats;
      years?: Record<string, BacktestStats>;
      error?: string;
    }>
  > => {
    const chunks = chunkRange(dates, range, options.workers, config.chunkDays);
    const jobs = items.flatMap((combo, i) =>
      chunks.map((chunk, c) => ({
        id: i * chunks.length + c,
        worker: c,
        strategy: combo.strategy,
        simulation: config.simulation,
        ...chunk,
      })),
    );
    const results = await runInWorkers(jobs, {
      ...options,
      onProgress: progress(`${phase} ${range.from} → ${range.to}`, jobs.length),
    });
    return items.map((_, i) => {
      const parts = results.slice(i * chunks.length, (i + 1) * chunks.length);
      const error = parts.find((part) => part?.error)?.error;
      if (error) return { error };
      const finalize = (partials: StatsPartial[]) => {
        const merged = mergePartials(partials);
        return merged
          ? finalizeStats(merged, config.simulation.startingCash)
          : undefined;
      };
      const byYear = new Map<string, StatsPartial[]>();
      const all: StatsPartial[] = [];
      parts.forEach((part, c) => {
        const year = chunks[c]?.from.slice(0, 4);
        if (!part?.partial || !year) return;
        all.push(part.partial);
        byYear.set(year, [...(byYear.get(year) ?? []), part.partial]);
      });
      const stats = finalize(all);
      const years: Record<string, BacktestStats> = {};
      for (const [year, partials] of byYear) {
        const yearStats = finalize(partials);
        if (yearStats) years[year] = yearStats;
      }
      return stats ? { stats, years } : {};
    });
  };

  const trainResults = await evaluate(combos, config.train, 'train');
  const rows: SweepRow[] = combos.map((combo, i) => {
    const result = trainResults[i];
    return {
      combo,
      train: result?.stats,
      ...(result?.years ? { trainYears: result.years } : {}),
      ...(result?.error ? { error: result.error } : {}),
    };
  });

  const ranked = rows
    .filter((row) => row.train && row.train.trades >= config.minTrades)
    .sort(
      (a, b) =>
        (b.train?.[config.rankBy] ?? 0) - (a.train?.[config.rankBy] ?? 0),
    );
  const top = distinctTop(ranked, config.top);

  const { test } = config;
  if (test && top.length > 0) {
    const testResults = await evaluate(
      top.map((row) => row.combo),
      test,
      'test',
    );
    top.forEach((row, i) => {
      const stats = testResults[i]?.stats;
      if (stats) row.test = stats;
    });
  }

  return {
    rows,
    ranked,
    top,
    marginals: computeMarginals(config, rows),
    invalid,
  };
}

// --- output ------------------------------------------------------------------------------------

const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(0)}`;
const factor = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function table(rows: ReadonlyArray<readonly string[]>): string[] {
  const widths: number[] = [];
  for (const row of rows)
    row.forEach(
      (cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)),
    );
  return rows.map((row) =>
    row
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0),
      )
      .join('  '),
  );
}

export function formatSweep(
  config: SweepConfig,
  outcome: SweepOutcome,
): string {
  const lines: string[] = [];
  lines.push(
    `Average effect of each setting on the training range (${outcome.rows.length} configs):`,
  );
  for (const axis of Object.keys(config.axes)) {
    const marginals = outcome.marginals.filter((m) => m.axis === axis);
    lines.push(
      '',
      ...table([
        [axis, 'mean P&L', 'median', 'profitable', 'trades'],
        ...marginals.map((m) => [
          m.label,
          money(m.meanNetPnl),
          money(m.medianNetPnl),
          pct(m.profitable),
          m.meanTrades.toFixed(0),
        ]),
      ]),
    );
  }

  lines.push(
    '',
    `Top ${outcome.top.length} by training ${config.rankBy} (of ${outcome.ranked.length} with ≥${config.minTrades} trades):`,
    '',
  );
  const years = [
    ...new Set(outcome.top.flatMap((row) => Object.keys(row.trainYears ?? {}))),
  ].sort();
  const header = [
    '#',
    'config',
    'train trades',
    'net',
    'PF',
    't',
    'max DD',
    ...years,
  ];
  if (config.test) header.push('test trades', 'net', 'PF', 't');
  lines.push(
    ...table([
      header,
      ...outcome.top.map((row, i) => {
        const train = row.train;
        const cells = [
          String(i + 1),
          Object.values(row.combo.choices).join(' · '),
          String(train?.trades ?? 0),
          money(train?.netPnl ?? 0),
          factor(train?.profitFactor ?? 0),
          (train?.tStat ?? 0).toFixed(1),
          money(-(train?.maxDrawdown ?? 0)),
          ...years.map((y) => {
            const stats = row.trainYears?.[y];
            return stats ? money(stats.netPnl) : '-';
          }),
        ];
        if (config.test) {
          cells.push(
            String(row.test?.trades ?? '-'),
            row.test ? money(row.test.netPnl) : '-',
            row.test ? factor(row.test.profitFactor) : '-',
            row.test ? row.test.tStat.toFixed(1) : '-',
          );
        }
        return cells;
      }),
    ]),
  );
  const twinNotes = outcome.top.flatMap((row, i) => {
    const summary = twinSummary(row);
    return summary ? [`  #${i + 1} is identical for any ${summary}`] : [];
  });
  if (twinNotes.length > 0)
    lines.push('', 'Settings that made no difference:', ...twinNotes);

  const profitable = outcome.rows.filter(
    (r) => (r.train?.netPnl ?? 0) > 0,
  ).length;
  lines.push(
    '',
    `${profitable} of ${outcome.rows.length} configs were profitable on the training range.`,
  );
  const leftOpen = outcome.rows.filter((r) => (r.train?.daysLeftOpen ?? 0) > 0);
  if (leftOpen.length > 0)
    lines.push(
      `Warning: ${leftOpen.length} configs ended a day with a position still open, e.g. ${describeChoices(leftOpen[0]?.combo.choices ?? {})} on ${leftOpen[0]?.train?.daysLeftOpen} days.`,
    );
  const errors = outcome.rows.filter((r) => r.error);
  if (errors.length > 0)
    lines.push(`${errors.length} configs failed, e.g. ${errors[0]?.error}`);
  if (outcome.invalid.length > 0) lines.push(`Invalid: ${outcome.invalid[0]}`);
  return lines.join('\n');
}

const round2 = (n: number) =>
  Number.isFinite(n) ? Math.round(n * 100) / 100 : n;

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * Writes results.csv (every config), marginals.csv, and top-NN.json for each top config, which
 * `backtest run --config` accepts as is.
 */
export function writeSweep(
  dir: string,
  config: SweepConfig,
  outcome: SweepOutcome,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'sweep.json'),
    JSON.stringify(config, null, 2) + '\n',
  );

  const axes = Object.keys(config.axes);
  const statColumns = [
    'trades',
    'tStat',
    'netPnl',
    'profitFactor',
    'winRate',
    'expectancy',
    'maxDrawdown',
  ] as const;
  const statCells = (stats: BacktestStats | undefined) =>
    statColumns.map((key) => (stats ? Number(stats[key].toFixed(4)) : ''));
  const years = [
    ...new Set(
      outcome.rows.flatMap((row) => Object.keys(row.trainYears ?? {})),
    ),
  ].sort();
  const tickers = [
    ...new Set(
      outcome.rows.flatMap((row) => Object.keys(row.train?.byTicker ?? {})),
    ),
  ].sort();
  const multiTicker = tickers.length > 1;
  const rows = [
    [
      'id',
      ...axes,
      ...statColumns.map((c) => `train_${c}`),
      ...years.map((y) => `train_${y}_netPnl`),
      ...(multiTicker ? tickers.map((t) => `train_${t}_netPnl`) : []),
      ...statColumns.map((c) => `test_${c}`),
      'error',
    ],
    ...outcome.rows.map((row) => [
      row.combo.id,
      ...axes.map((axis) => row.combo.choices[axis] ?? ''),
      ...statCells(row.train),
      ...years.map((y) => row.trainYears?.[y]?.netPnl.toFixed(2) ?? ''),
      ...(multiTicker
        ? tickers.map((t) => row.train?.byTicker[t]?.netPnl.toFixed(2) ?? '')
        : []),
      ...statCells(row.test),
      row.error ?? '',
    ]),
  ];
  const compact = (stats: BacktestStats | undefined) =>
    stats && {
      trades: stats.trades,
      netPnl: round2(stats.netPnl),
      tStat: round2(stats.tStat),
      profitFactor: round2(stats.profitFactor),
      winRate: round2(stats.winRate),
      maxDrawdown: round2(stats.maxDrawdown),
      daysLeftOpen: stats.daysLeftOpen,
      byTicker: stats.byTicker,
      byReason: stats.byReason,
    };
  writeFileSync(
    join(dir, 'results.jsonl'),
    outcome.rows
      .map((row) =>
        JSON.stringify({
          id: row.combo.id,
          choices: row.combo.choices,
          train: compact(row.train),
          years: Object.fromEntries(
            Object.entries(row.trainYears ?? {}).map(([y, s]) => [
              y,
              compact(s),
            ]),
          ),
          test: compact(row.test),
          error: row.error,
        }),
      )
      .join('\n') + '\n',
  );
  writeFileSync(
    join(dir, 'results.csv'),
    rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
  );

  const marginalRows = [
    [
      'axis',
      'label',
      'configs',
      'mean_net_pnl',
      'median_net_pnl',
      'profitable',
      'mean_trades',
    ],
    ...outcome.marginals.map((m) => [
      m.axis,
      m.label,
      m.configs,
      m.meanNetPnl.toFixed(2),
      m.medianNetPnl.toFixed(2),
      m.profitable.toFixed(3),
      m.meanTrades.toFixed(1),
    ]),
  ];
  writeFileSync(
    join(dir, 'marginals.csv'),
    marginalRows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
  );

  outcome.top.forEach((row, i) => {
    const name = `${config.name}-top-${String(i + 1).padStart(2, '0')}`;
    const runConfig = {
      name,
      description: describeChoices(row.combo.choices),
      ...(row.twins?.length ? { identicalFor: twinSummary(row) } : {}),
      from: config.train.from,
      to: config.test?.to ?? config.train.to,
      strategy: row.combo.strategy,
      simulation: config.simulation,
    };
    writeFileSync(
      join(dir, `top-${String(i + 1).padStart(2, '0')}.json`),
      JSON.stringify(runConfig, null, 2) + '\n',
    );
  });
}
