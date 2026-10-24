import { Processor } from '@nestjs/bullmq';

import { QueueConfigMap, UniverseJob, UniverseJobResult } from './common';

type WorkerOptions = Parameters<typeof Processor>[1];

type UniverseProcessorClass<
  C extends QueueConfigMap,
  T extends keyof C,
> = abstract new (...args: never[]) => {
  process(
    job: UniverseJob<C, T>,
    token?: string,
  ): Promise<UniverseJobResult<C, T>>;
};

export function UniverseProcessor<C extends QueueConfigMap, T extends keyof C>(
  queueConfig: C,
  queueKey: T,
  workerOptions: WorkerOptions = {},
) {
  const config = queueConfig[queueKey];
  if (!config) {
    throw new Error(`Unknown queue key: ${String(queueKey)}`);
  }
  const decorator = Processor(config.queueName, workerOptions);

  return <P extends UniverseProcessorClass<C, T>>(target: P): void => {
    decorator(target);
  };
}
