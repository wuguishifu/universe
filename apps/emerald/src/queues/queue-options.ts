import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

import { BULL_QUEUE_PREFIX, parseRedisUrl } from '@universe/redis';

import { EnvironmentService } from '../environment/environment-service';

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = parseRedisUrl(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: BULL_QUEUE_PREFIX,
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
