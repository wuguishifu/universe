import type { Config } from 'drizzle-kit';

export default {
  schema: '../db/src/schemas/*',
  out: './src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: '',
  },
} satisfies Config;
