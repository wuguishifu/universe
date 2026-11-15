import { parentPort, workerData } from 'node:worker_threads';

import { CachedDataStore } from '../data/data-store';
import { computeStats } from '../report/stats';
import { runBacktest } from '../sim/backtest';

import { BacktestJob, JobResult } from './pool';

// Each worker keeps its own copy of the data in memory and runs jobs one at a time.
const store = new CachedDataStore(String(workerData));

parentPort?.on('message', async (job: BacktestJob) => {
  let result: JobResult;
  try {
    const backtest = await runBacktest({ ...job, store });
    result = { id: job.id, stats: computeStats(backtest) };
  } catch (error) {
    result = {
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  parentPort?.postMessage(result);
});
