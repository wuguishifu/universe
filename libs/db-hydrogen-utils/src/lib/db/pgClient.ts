import { environmentConfig } from '@wuguishifu/environment';
import { buildConnectionString } from '@wuguishifu/nest-common';
import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString =
  process.env['HYDROGEN_DB_URL'] || buildConnectionString(environmentConfig.hydrogen, { excludeDb: true });

const isLocalHost = (host?: string) => Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));

const isLocalDb = isLocalHost(connectionString);

// Set HYDROGEN_DB_SSL=false when connecting to servers that don't support SSL (e.g. via Tailscale)
const useSsl = process.env['HYDROGEN_DB_SSL'] !== 'false' && process.env['HYDROGEN_DB_SSL'] !== '0';

// Parse the connection string to modify the database name
const url = new URL(connectionString);
url.pathname = '/defaultdb';

const remoteConnectionString = url.toString();

export const postgresDb = isLocalDb
  ? jsDrizzle(postgres(connectionString, { max: 1, db: 'postgres' }))
  : jsDrizzle(
      postgres(remoteConnectionString, {
        max: 1,
        ...(useSsl ? { ssl: { rejectUnauthorized: false } } : { ssl: false }),
        connection: {
          application_name: 'hydrogen-setup',
        },
      }),
    );
