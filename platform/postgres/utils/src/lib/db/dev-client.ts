import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import { migrate as jsMigrate } from 'drizzle-orm/postgres-js/migrator';
import { Pool, PoolConfig } from 'pg';
import postgres from 'postgres';

import {
  connectionString,
  isLocalDb,
  useSsl,
} from './environment-db-credentials';

const basePoolConfig: PoolConfig = {
  connectionString: connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : { ssl: false }),
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 300000,
};

export const universeDb = isLocalDb
  ? jsDrizzle(postgres(connectionString, { max: 1 }))
  : drizzle(
      new Pool({
        ...basePoolConfig,
        database: 'universe',
      }),
    );

export const dbMigrate = (migrationsFolder: string) =>
  isLocalDb
    ? jsMigrate(jsDrizzle(postgres(connectionString, { max: 1 })), {
        migrationsFolder,
      })
    : migrate(
        drizzle(
          new Pool({
            ...basePoolConfig,
            database: 'universe',
          }),
        ),
        { migrationsFolder },
      );
