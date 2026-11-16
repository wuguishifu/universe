import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { alignDaily, runDaily } from './daily/daily-backtest';
import {
  loadDailySuite,
  suiteAllocations,
  suiteTickers,
} from './daily/daily-config';
import { formatDailySuite, writeDailySuite } from './daily/daily-report';
import { dailyStats } from './daily/daily-stats';
import { DataStore } from './data/data-store';
import { AlpacaClient } from './download/alpaca-client';
import { download, downloadDaily } from './download/download';
import { downloadMinutes, loadMinuteJobs } from './download/download-minutes';
import {
  downloadChainSnapshots,
  downloadQuotes,
} from './download/download-quotes';
import { ThetaClient } from './download/theta-client';
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
  backtest download --from YYYY-MM-DD --to YYYY-MM-DD [--tickers SPY,QQQ] [--data <dir>] [--stocks-only]
                    [--expiry-days 7] [--strike-padding 10] [--strike-step 1] [--warmup-days 5]
  backtest download-quotes --from YYYY-MM-DD --to YYYY-MM-DD [--tickers SPY,QQQ] [--data <dir>]
                    [--expiry-days 7] [--strike-padding 10] [--strike-step 1] [--concurrency 2]
                    [--full-chain] [--probe]
  backtest download-chains --from YYYY-MM-DD --to YYYY-MM-DD [--tickers SPY] [--data <dir>]
                    [--max-dte 60] [--low 0.6] [--high 1.25] [--minutes-before-close 15] [--concurrency 2]
  backtest download-minutes --jobs <file> [--data <dir>]
                    jobs file: { "window": "day" | "open15", "days": { "YYYY-MM-DD": ["AAPL", ...] } }
  backtest sweep    --config <file> [--data <dir>] [--out <dir>] [--workers N]
  backtest download-daily --from YYYY-MM-DD --to YYYY-MM-DD (--tickers SPY,EFA | --tickers-file <file>)
                    [--adjustment all|raw] [--skip-existing] [--data <dir>]
  backtest daily    --config <file> [--cost-bps N] [--data <dir>] [--out <dir>]

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
      'stocks-only': { type: 'boolean', default: false },
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
    stocksOnly: values['stocks-only'],
    log: print,
  });
  print('Done.');
}

async function downloadQuotesCommand(args: string[]): Promise<void> {
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
      concurrency: { type: 'string', default: '2' },
      'full-chain': { type: 'boolean', default: false },
      probe: { type: 'boolean', default: false },
    },
  });
  if (!values.from || !values.to)
    throw new Error('download-quotes needs --from and --to');
  const tickers = values.tickers.split(',').map((t) => t.trim().toUpperCase());
  const client = ThetaClient.fromEnv();

  if (values.probe) {
    // Shows what Theta Data actually sends for one small request, without writing anything.
    const [symbol = 'SPY'] = tickers;
    const request = {
      symbol,
      date: values.from,
      maxDte: 0,
      strikeRange: 1,
      startTime: '15:00:00',
      endTime: '15:02:00',
    };
    print(`GET ${client.optionQuotesUrl(request).toString()}`);
    let lines = 0;
    const found = await client.optionQuotes(
      request,
      () => {
        lines = 0;
      },
      (line) => {
        if (lines++ < 12) print(line);
      },
    );
    print(
      found ? `${lines} lines in all.` : 'Theta Data has no data for that.',
    );
    return;
  }

  await downloadQuotes({
    client,
    dir: resolve(values.data),
    tickers,
    from: values.from,
    to: values.to,
    expiryDays: Number(values['expiry-days']),
    strikePadding: Number(values['strike-padding']),
    strikeStep: Number(values['strike-step']),
    narrowRequest: !values['full-chain'],
    concurrency: Number(values.concurrency),
    log: print,
  });
  print('Done.');
}

async function downloadChainsCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      tickers: { type: 'string', default: 'SPY' },
      data: { type: 'string', default: 'data' },
      'max-dte': { type: 'string', default: '60' },
      low: { type: 'string', default: '0.6' },
      high: { type: 'string', default: '1.25' },
      'minutes-before-close': { type: 'string', default: '15' },
      concurrency: { type: 'string', default: '2' },
    },
  });
  if (!values.from || !values.to)
    throw new Error('download-chains needs --from and --to');
  await downloadChainSnapshots({
    client: ThetaClient.fromEnv(),
    dir: resolve(values.data),
    tickers: values.tickers.split(',').map((t) => t.trim().toUpperCase()),
    from: values.from,
    to: values.to,
    maxDte: Number(values['max-dte']),
    lowFraction: Number(values.low),
    highFraction: Number(values.high),
    minutesBeforeClose: Number(values['minutes-before-close']),
    concurrency: Number(values.concurrency),
    log: print,
  });
  print('Done.');
}

async function downloadMinutesCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      jobs: { type: 'string' },
      data: { type: 'string', default: 'data' },
    },
  });
  if (!values.jobs) throw new Error('download-minutes needs --jobs');
  await downloadMinutes({
    client: AlpacaClient.fromEnv(),
    dir: resolve(values.data),
    jobs: loadMinuteJobs(values.jobs),
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

async function downloadDailyCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      tickers: { type: 'string' },
      'tickers-file': { type: 'string' },
      adjustment: { type: 'string', default: 'all' },
      'skip-existing': { type: 'boolean', default: false },
      data: { type: 'string', default: 'data' },
    },
  });
  const list = values['tickers-file']
    ? readFileSync(values['tickers-file'], 'utf8')
    : values.tickers;
  if (!values.from || !values.to || !list)
    throw new Error(
      'download-daily needs --from, --to and --tickers or --tickers-file',
    );
  const { adjustment } = values;
  if (adjustment !== 'all' && adjustment !== 'raw')
    throw new Error('--adjustment is all or raw');
  await downloadDaily({
    client: AlpacaClient.fromEnv(),
    dir: resolve(values.data),
    tickers: [
      ...new Set(
        list
          .split(/[\s,]+/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
      ),
    ],
    from: values.from,
    to: values.to,
    adjustment,
    skipExisting: values['skip-existing'],
    log: print,
  });
  print('Done.');
}

function dailyCommand(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      'cost-bps': { type: 'string' },
      data: { type: 'string', default: 'data' },
      out: { type: 'string', default: 'runs' },
    },
  });
  if (!values.config) throw new Error('daily needs --config');
  const loaded = loadDailySuite(values.config);
  const suite =
    values['cost-bps'] === undefined
      ? loaded
      : { ...loaded, costBps: Number(values['cost-bps']) };

  const store = new DataStore(resolve(values.data));
  const bars = Object.fromEntries(
    suiteTickers(suite).map((ticker) => {
      const list = store.dailyBars(ticker);
      if (!list) {
        throw new Error(
          `No daily bars for ${ticker}. Run download-daily with --tickers=${ticker}.`,
        );
      }
      return [ticker, list];
    }),
  );
  const series = alignDaily(bars);
  if (series.dropped.length > 0) {
    print(
      `Dropped ${series.dropped.length} dates that some ticker is missing: ${series.dropped.slice(0, 5).join(', ')}${series.dropped.length > 5 ? ', ...' : ''}`,
    );
  }

  const options = {
    from: suite.from,
    to: suite.to,
    startingCash: suite.startingCash,
    costBps: suite.costBps,
  };
  const outcomes = suiteAllocations(suite).map(([label, config]) => {
    const result = runDaily(config, series, options);
    return { label, result, stats: dailyStats(result) };
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(
    join(values.out, `${stamp}-daily-${suite.name}-${suite.costBps}bp`),
  );
  writeDailySuite(outDir, suite, outcomes);
  print(formatDailySuite(suite, outcomes));
  print();
  print(`Wrote ${outDir}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'run') await run(args);
  else if (command === 'download') await downloadCommand(args);
  else if (command === 'download-quotes') await downloadQuotesCommand(args);
  else if (command === 'download-chains') await downloadChainsCommand(args);
  else if (command === 'download-minutes') await downloadMinutesCommand(args);
  else if (command === 'sweep') await sweepCommand(args);
  else if (command === 'download-daily') await downloadDailyCommand(args);
  else if (command === 'daily') dailyCommand(args);
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
