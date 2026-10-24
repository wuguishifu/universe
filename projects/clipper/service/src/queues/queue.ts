import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

import { BullQueueModule, createBullRootOptions } from '@libs/queue';
import {
  CLIPPER_JOB_OPTIONS,
  CLIPPER_QUEUE_CONFIG,
  CLIPPER_QUEUE_PREFIX,
  type ClipperQueueKey,
} from '@projects/clipper-contracts';

import { EnvironmentService } from '../config/environment';

export const registerQueue = (queueKey: ClipperQueueKey) =>
  BullQueueModule.register(
    CLIPPER_QUEUE_CONFIG,
    queueKey,
    CLIPPER_JOB_OPTIONS[queueKey],
  );

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    return createBullRootOptions(
      this.environmentService.environment.redisUrl,
      CLIPPER_QUEUE_PREFIX,
    );
  }
}
