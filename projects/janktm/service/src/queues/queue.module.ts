import { Module } from '@nestjs/common';

import { BullQueueModule, BullRootModule } from '@libs/queue';

import { EnvironmentModule, EnvironmentService } from '../config/environment';

import {
  JANKTM_JOB_OPTIONS,
  JANKTM_QUEUE_CONFIG,
  JANKTM_QUEUE_PREFIX,
  type JanktmQueueKey,
} from './queue';

const registerQueue = (queueKey: JanktmQueueKey) =>
  BullQueueModule.register(
    JANKTM_QUEUE_CONFIG,
    queueKey,
    JANKTM_JOB_OPTIONS[queueKey],
  );

@Module({
  imports: [
    BullRootModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        redisUrl: environmentService.environment.redisUrl,
        prefix: JANKTM_QUEUE_PREFIX,
      }),
    }),
    registerQueue('scan'),
    registerQueue('reprocess'),
    registerQueue('complete'),
  ],
})
export class QueueModule {}
