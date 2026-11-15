import { Worker } from 'node:worker_threads';

import { StrategyConfig } from '@projects/trading-core';

import { BacktestStats } from '../report/stats';
import { SimulationConfig } from '../sim/simulation-config';

export type BacktestJob = {
  id: number;
  strategy: StrategyConfig;
  simulation: SimulationConfig;
  from: string;
  to: string;
};

export type JobResult = { id: number; stats?: BacktestStats; error?: string };

/** Runs backtests across worker threads. Results come back in the same order as `jobs`. */
export async function runInWorkers(
  jobs: readonly BacktestJob[],
  options: {
    dataDir: string;
    workers: number;
    onProgress?: (done: number) => void;
  },
): Promise<JobResult[]> {
  const results: JobResult[] = new Array(jobs.length);
  if (jobs.length === 0) return results;

  const workerCount = Math.max(1, Math.min(options.workers, jobs.length));
  const indexById = new Map(jobs.map((job, i) => [job.id, i]));
  let next = 0;
  let done = 0;

  await new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    const finish = (error?: Error) => {
      for (const worker of workers) void worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    const feed = (worker: Worker) => {
      const job = jobs[next++];
      if (job) worker.postMessage(job);
    };

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        workerData: options.dataDir,
      });
      workers.push(worker);
      worker.on('message', (result: JobResult) => {
        const index = indexById.get(result.id);
        if (index !== undefined) results[index] = result;
        done += 1;
        options.onProgress?.(done);
        if (done === jobs.length) finish();
        else feed(worker);
      });
      worker.on('error', finish);
      feed(worker);
    }
  });
  return results;
}
