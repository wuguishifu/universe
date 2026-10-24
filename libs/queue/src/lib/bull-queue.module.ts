import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { type JobsOptions } from 'bullmq';

import { DEFAULT_QUEUE_CONFIG, QueueConfigMap, UniverseQueue } from './common';

@Module({})
export class BullQueueModule {
  static register<C extends QueueConfigMap, T extends keyof C>(
    queueConfig: C,
    queueKey: T,
    defaultJobOptions: JobsOptions = DEFAULT_QUEUE_CONFIG,
  ): DynamicModule {
    const config = queueConfig[queueKey];
    if (!config) {
      throw new Error(`Unknown queue key: ${String(queueKey)}`);
    }
    const token = config.queueName;

    return {
      module: BullQueueModule,
      global: true,
      imports: [
        BullModule.registerQueue({
          name: config.queueName,
          defaultJobOptions,
        }),
      ],
      providers: [
        {
          provide: token,
          useFactory: (queue: UniverseQueue<C, T>) => queue,
          inject: [getQueueToken(config.queueName)],
        },
      ],
      exports: [token],
    };
  }
}
