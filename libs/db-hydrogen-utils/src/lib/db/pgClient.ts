import { environmentConfig } from '@wuguishifu/environment';
import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { buildConnectionString } from '../build-connection-string';

const connectionString =
  process.env['HYDROGEN_DB_URL'] || buildConnectionString(environmentConfig.hydrogen, { excludeDb: true });

const isLocalHost = (host?: string) => Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));

const isLocalDb = isLocalHost(connectionString);

// Parse the connection string to modify the database name
const url = new URL(connectionString);
url.pathname = '/defaultdb';

const remoteConnectionString = url.toString();

export const postgresDb = isLocalDb
  ? jsDrizzle(postgres(connectionString, { max: 1, db: 'postgres' }))
  : jsDrizzle(
      postgres(remoteConnectionString, {
        max: 1,
        ssl: { rejectUnauthorized: false }, // Add SSL configuration for remote connections
        connection: {
          application_name: 'hydrogen-setup',
        },
      }),
    );
