import type { Config } from 'drizzle-kit';

import { parsed } from './src/lib/db/environmentDbCredentials';

export default {
  schema: '../db-hydrogen/src/db/schemas/*',
  out: './src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: parsed.HYDROGEN_HOST,
    port: parsed.HYDROGEN_PORT,
    user: parsed.HYDROGEN_USER,
    password: parsed.HYDROGEN_PASSWORD,
    database: parsed.HYDROGEN_DATABASE,
  },
} satisfies Config;
