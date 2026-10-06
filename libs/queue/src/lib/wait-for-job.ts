import { QueueEvents } from 'bullmq';
import { QueueConfigMap, UniverseJob, UniverseJobResult } from './common';

export async function waitForJobResult<
  C extends QueueConfigMap,
  T extends keyof C,
>(
  queueConfig: C,
  queueKey: T,
  job: UniverseJob<C, T>,
  queueEvents: QueueEvents,
  ttl?: number,
): Promise<UniverseJobResult<C, T>> {
  const config = queueConfig[queueKey];
  if (!config) {
    throw new Error(`Unknown queue key: ${String(queueKey)}`);
  }
  const result = await job.waitUntilFinished(queueEvents, ttl);
  config.resultsSchema?.parse(result);
  return result;
}
