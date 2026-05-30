import { drizzle as jsDrizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  connectionString,
  isLocalDb,
  useSsl,
} from './environment-db-credentials';

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
          application_name: 'pluto-setup',
        },
      }),
    );
