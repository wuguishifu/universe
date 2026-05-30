import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  BULL_QUEUE_CONFIG,
  DEFAULT_QUEUE_CONFIG,
  type JobData,
} from '@universe/redis';

type BullQueueKey = keyof typeof BULL_QUEUE_CONFIG;

export type EmeraldQueue<T extends BullQueueKey> = Queue<
  JobData<T>,
  unknown,
  (typeof BULL_QUEUE_CONFIG)[T]['jobName']
>;

@Module({})
export class BullQueueModule {
  static register<T extends BullQueueKey>(queueKey: T): DynamicModule {
    const config = BULL_QUEUE_CONFIG[queueKey];
    const token = config.queueName;

    return {
      module: BullQueueModule,
      global: true,
      imports: [
        BullModule.registerQueue({
          name: config.queueName,
          defaultJobOptions: DEFAULT_QUEUE_CONFIG,
        }),
      ],
      providers: [
        {
          provide: token,
          useFactory: (queue: EmeraldQueue<T>) => queue,
          inject: [getQueueToken(config.queueName)],
        },
      ],
      exports: [token],
    };
  }
}
