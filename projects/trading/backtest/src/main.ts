import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { DataStore } from './data/data-store';
import { AlpacaClient } from './download/alpaca-client';
import { download } from './download/download';
import { formatSummary, writeRun } from './report/report';
import { computeStats } from './report/stats';
import {
  loadRunConfig,
  PRESETS,
  resolveStrategy,
  RunConfig,
  runConfigSchema,
} from './run-config';
import { runBacktest } from './sim/backtest';
import { formatSweep, runSweep, writeSweep } from './sweep/sweep';
import { loadSweepConfig } from './sweep/sweep-config';

const print = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

const USAGE = `Usage:
  backtest run      [--config <file> | --preset <name>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                    [--data <dir>] [--out <dir>] [--daily]
  backtest download --from YYYY-MM-DD --to YYYY-MM-DD [--tickers SPY,QQQ] [--data <dir>]
                    [--expiry-days 7] [--strike-padding 10] [--strike-step 1] [--warmup-days 5]
  backtest sweep    --config <file> [--data <dir>] [--out <dir>] [--workers N]

Presets: ${Object.keys(PRESETS).join(', ')}
Paths are relative to projects/trading/backtest. Data defaults to ./data, runs to ./runs.`;

async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      preset: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      data: { type: 'string', default: 'data' },
      out: { type: 'string', default: 'runs' },
      daily: { type: 'boolean', default: false },
    },
  });

  const config: RunConfig = values.config
    ? loadRunConfig(values.config)
    : runConfigSchema.parse({
        name: values.preset ?? 'ema-vwap-crossover',
        strategy: { preset: values.preset ?? 'ema-vwap-crossover' },
      });
  const from = values.from ?? config.from;
  const to = values.to ?? config.to;
  if (!from || !to)
    throw new Error('Give --from and --to, or set them in the config');

  const strategy = resolveStrategy(config.strategy);
  print(
    `Backtesting ${config.name} on ${strategy.tickers.join(', ')}, ${from} → ${to}`,
  );
  const started = Date.now();
  const result = await runBacktest({
    strategy,
    simulation: config.simulation,
    store: new DataStore(resolve(values.data)),
    from,
    to,
    onDay: (day) => {
      if (!values.daily) return;
      const pnl =
        day.netPnl >= 0 ? `+${day.netPnl.toFixed(2)}` : day.netPnl.toFixed(2);
      print(
        `  ${day.date}  ${String(day.trades).padStart(2)} trades  ${pnl.padStart(10)}  equity ${day.equity.toFixed(2)}`,
      );
    },
  });

  const stats = computeStats(result);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(join(values.out, `${stamp}-${config.name}`));
  writeRun(outDir, config.name, result, stats);

  print();
  print(formatSummary(config.name, result, stats));
  print();
  print(
    `Finished in ${((Date.now() - started) / 1000).toFixed(1)}s. Wrote ${outDir}`,
  );
}

async function downloadCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      tickers: { type: 'string', default: 'SPY' },
      data: { type: 'string', default: 'data' },
      'expiry-days': { type: 'string', default: '7' },
      'strike-padding': { type: 'string', default: '10' },
      'strike-step': { type: 'string', default: '1' },
      'warmup-days': { type: 'string', default: '5' },
    },
  });
  if (!values.from || !values.to)
    throw new Error('download needs --from and --to');

  await download({
    client: AlpacaClient.fromEnv(),
    dir: resolve(values.data),
    tickers: values.tickers.split(',').map((t) => t.trim().toUpperCase()),
    from: values.from,
    to: values.to,
    expiryDays: Number(values['expiry-days']),
    strikePadding: Number(values['strike-padding']),
    strikeStep: Number(values['strike-step']),
    warmupDays: Number(values['warmup-days']),
    log: print,
  });
  print('Done.');
}

async function sweepCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      data: { type: 'string', default: 'data' },
      out: { type: 'string', default: 'runs' },
      workers: {
        type: 'string',
        default: String(Math.max(1, availableParallelism() - 1)),
      },
    },
  });
  if (!values.config) throw new Error('sweep needs --config');

  const config = loadSweepConfig(values.config);
  const started = Date.now();
  print(`Sweeping ${config.name} with ${values.workers} workers`);
  const outcome = await runSweep(config, {
    dataDir: resolve(values.data),
    workers: Number(values.workers),
    log: print,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(join(values.out, `${stamp}-sweep-${config.name}`));
  writeSweep(outDir, config, outcome);
  print();
  print(formatSweep(config, outcome));
  print();
  print(
    `Finished in ${((Date.now() - started) / 1000).toFixed(0)}s. Wrote ${outDir}`,
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'run') await run(args);
  else if (command === 'download') await downloadCommand(args);
  else if (command === 'sweep') await sweepCommand(args);
  else {
    print(USAGE);
    process.exitCode = command ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
