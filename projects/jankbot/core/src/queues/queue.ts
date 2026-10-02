import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { BullQueueModule, createBullRootOptions } from '@libs/queue';
import {
  JANKBOT_JOB_OPTIONS,
  JANKBOT_QUEUE_CONFIG,
  JANKBOT_QUEUE_PREFIX,
  type JankbotQueueKey,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../environment/environment-service';

export const registerQueue = (queueKey: JankbotQueueKey) =>
  BullQueueModule.register(
    JANKBOT_QUEUE_CONFIG,
    queueKey,
    JANKBOT_JOB_OPTIONS[queueKey],
  );

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    return createBullRootOptions(
      this.environmentService.environment.redisUrl,
      JANKBOT_QUEUE_PREFIX,
    );
  }
}
