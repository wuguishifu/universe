import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type JobsOptions } from 'bullmq';
import {
  BullQueueModule,
  SILVER_QUEUE_CONFIG,
  SilverQueueKey,
  resolveRedisConnection,
} from '@universe/queue';
import { EnvironmentService } from '../environment/environment-service';

export const registerQueue = <T extends SilverQueueKey>(
  queueKey: T,
  defaultJobOptions?: JobsOptions,
) => BullQueueModule.register(SILVER_QUEUE_CONFIG, queueKey, defaultJobOptions);

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = resolveRedisConnection(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: 'silver-queue',
      connection: {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        family: connection.family,
      },
    };
  }
}
