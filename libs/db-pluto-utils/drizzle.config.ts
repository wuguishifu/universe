import type { Config } from 'drizzle-kit';

import { parsed } from './src/lib/db/environmentDbCredentials';

export default {
  schema: '../db-pluto/src/db/schemas/*',
  out: './src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: parsed.PLUTO_HOST,
    port: parsed.PLUTO_PORT,
    user: parsed.PLUTO_USER,
    password: parsed.PLUTO_PASSWORD,
    database: parsed.PLUTO_DATABASE,
  },
} satisfies Config;
