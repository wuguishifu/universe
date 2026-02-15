import { Logger } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { buildConnectionString, DbConfig } from './buildConnectionString';

export type DbClient = PostgresJsDatabase;

export type GetDbClientOptions = { connectionString: string } | { dbConfig: DbConfig };

export const getDbClient = (options: GetDbClientOptions): DbClient => {
  const connectionString =
    'connectionString' in options ? options.connectionString : buildConnectionString(options.dbConfig);
  const databaseName =
    'connectionString' in options
      ? (() => {
          try {
            return new URL(connectionString).pathname.slice(1) || 'hydrogen';
          } catch {
            return 'hydrogen';
          }
        })()
      : options.dbConfig.database;
  const queryClient = postgres(connectionString, { connect_timeout: 30, idle_timeout: 300 });
  new Logger(databaseName).debug(`Creating DB Client: '${databaseName}' DB`);
  return drizzle(queryClient);
};
