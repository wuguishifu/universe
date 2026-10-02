import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { resolveRedisConnection } from '@libs/queue';
import { EnvironmentService } from '../../environment/environment-service';

/** Plain Redis access for state shared with jankbot-gateway (BullMQ keeps its own connections). */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(environmentService: EnvironmentService) {
    this.client = new Redis(
      resolveRedisConnection(environmentService.environment.redisUrl),
    );
  }

  async onApplicationShutdown() {
    await this.client.quit();
  }
}
