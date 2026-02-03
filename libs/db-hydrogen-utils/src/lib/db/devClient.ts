import { environmentConfig } from '@wuguishifu/environment';
import { buildConnectionString } from '@wuguishifu/nest-common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import { migrate as jsMigrate } from 'drizzle-orm/postgres-js/migrator';
import { Pool, PoolConfig } from 'pg';
import postgres from 'postgres';

const connectionString = process.env['HYDROGEN_DB_URL'] || buildConnectionString(environmentConfig.hydrogen);

const isLocalHost = (host?: string) => Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));

const isLocalDb = isLocalHost(connectionString);

const basePoolConfig: PoolConfig = {
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 300000,
};

export const hydrogenDb = isLocalDb
  ? jsDrizzle(postgres(connectionString, { max: 1 }))
  : drizzle(
      new Pool({
        ...basePoolConfig,
        database: 'hydrogen',
      }),
    );

export const dbMigrate = (migrationsFolder: string) =>
  isLocalDb
    ? jsMigrate(jsDrizzle(postgres(connectionString, { max: 1 })), { migrationsFolder })
    : migrate(
        drizzle(
          new Pool({
            ...basePoolConfig,
            database: 'hydrogen',
          }),
        ),
        { migrationsFolder },
      );
