import { Worker } from 'node:worker_threads';

import { StrategyConfig } from '@projects/trading-core';

import { StatsPartial } from '../report/stats';
import { SimulationConfig } from '../sim/simulation-config';

export type BacktestJob = {
  id: number;
  strategy: StrategyConfig;
  simulation: SimulationConfig;
  from: string;
  to: string;
};

export type JobResult = { id: number; partial?: StatsPartial; error?: string };

/**
 * Runs backtests on worker threads. Each job names the worker it must run on, so a worker only
 * ever reads (and keeps in memory) the days of its own jobs. Results come back in job order.
 */
export async function runInWorkers(
  jobs: ReadonlyArray<BacktestJob & { worker: number }>,
  options: {
    dataDir: string;
    workers: number;
    onProgress?: (done: number) => void;
  },
): Promise<JobResult[]> {
  const results: JobResult[] = new Array(jobs.length);
  if (jobs.length === 0) return results;

  const queues: Array<Array<{ job: BacktestJob; index: number }>> = Array.from(
    { length: options.workers },
    () => [],
  );
  jobs.forEach(({ worker, ...job }, index) => {
    const queue = queues[worker % options.workers];
    queue?.push({ job, index });
  });

  let done = 0;
  await new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    const finish = (error?: Error) => {
      for (const worker of workers) void worker.terminate();
      if (error) reject(error);
      else resolve();
    };

    queues.forEach((queue) => {
      if (queue.length === 0) return;
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        workerData: options.dataDir,
      });
      workers.push(worker);
      let next = 0;
      const feed = () => {
        const entry = queue[next];
        if (entry) worker.postMessage(entry.job);
      };
      worker.on('message', (result: JobResult) => {
        const entry = queue[next++];
        if (entry) results[entry.index] = result;
        done += 1;
        options.onProgress?.(done);
        if (done === jobs.length) finish();
        else feed();
      });
      worker.on('error', finish);
      feed();
    });
  });
  return results;
}
