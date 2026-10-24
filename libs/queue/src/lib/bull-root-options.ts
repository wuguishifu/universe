import { type BullRootModuleOptions } from '@nestjs/bullmq';

import { resolveRedisConnection } from '@libs/redis-cache';

export function createBullRootOptions(
  redisUrl: string,
  prefix: string,
): BullRootModuleOptions {
  const connection = resolveRedisConnection(redisUrl);

  return {
    prefix,
    connection: {
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      family: connection.family,
    },
  };
}
