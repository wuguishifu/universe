import { Logger } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type GetDbClientOptions = { connectionString: string };

export const getDbClient = (
  options: GetDbClientOptions,
): PostgresJsDatabase => {
  const databaseName = (() => {
    try {
      return new URL(options.connectionString).pathname.slice(1) || 'pluto';
    } catch {
      return 'pluto';
    }
  })();
  const queryClient = postgres(options.connectionString, {
    connect_timeout: 30,
    idle_timeout: 300,
  });
  new Logger(databaseName).debug(`Creating DB Client: '${databaseName}' DB`);
  return drizzle(queryClient);
};
