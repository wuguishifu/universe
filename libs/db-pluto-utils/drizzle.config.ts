import type { Config } from 'drizzle-kit';

import { parsed } from './src/lib/db/environment-db-credentials';

export default {
  schema: '../db-pluto/src/db/schemas/*',
  out: './src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: parsed.PLUTO_DB_CONNECTION_STRING,
  },
} satisfies Config;
