import { type BullRootModuleOptions } from '@nestjs/bullmq';
import { resolveRedisConnection } from './redis-url';

/** Root BullMQ options for services that share queues: same Redis and the same key prefix. */
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
