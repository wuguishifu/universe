import { Logger } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { buildConnectionString, DbConfig } from './buildConnectionString';

export type DbClient = PostgresJsDatabase;

export const getDbClient = ({ dbConfig, environment }: { dbConfig: DbConfig; environment: string }): DbClient => {
  const connectionString = buildConnectionString(dbConfig);
  const queryClient = postgres(connectionString, { connect_timeout: 30, idle_timeout: 300 });
  new Logger(dbConfig.database).debug(`Creating DB Client: '${dbConfig.database}' DB in ${environment} environment`);
  return drizzle(queryClient);
};
