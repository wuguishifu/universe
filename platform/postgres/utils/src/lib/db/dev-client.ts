import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import { migrate as jsMigrate } from 'drizzle-orm/postgres-js/migrator';
import { Client, Pool, PoolConfig } from 'pg';
import postgres from 'postgres';

import {
  connectionString,
  isLocalDb,
  useSsl,
} from './environment-db-credentials';

// The database comes from the connection string's path (e.g. `/universe`).
const basePoolConfig: PoolConfig = {
  connectionString: connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : { ssl: false }),
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 300000,
};

export const universeDb = isLocalDb
  ? jsDrizzle(postgres(connectionString, { max: 1 }))
  : drizzle(new Pool(basePoolConfig));

// Arbitrary app-wide key; any concurrent migrate run blocks on it until the first one finishes.
const MIGRATION_LOCK_KEY = 7_204_311;

// Runs on a single connection so the advisory lock and the migration share a session.
export const dbMigrate = async (migrationsFolder: string) => {
  if (isLocalDb) {
    const client = postgres(connectionString, { max: 1 });
    const db = jsDrizzle(client);
    try {
      await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
      await jsMigrate(db, { migrationsFolder });
    } finally {
      await client.end();
    }
    return;
  }

  const client = new Client(basePoolConfig);
  await client.connect();
  const db = drizzle(client);
  try {
    await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    await migrate(db, { migrationsFolder });
  } finally {
    // Closing the session releases the lock.
    await client.end();
  }
};
