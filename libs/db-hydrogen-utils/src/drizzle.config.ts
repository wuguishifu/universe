import { environmentConfig } from '@wuguishifu/environment';
import type { Config } from 'drizzle-kit';

export default {
  schema: '../../db-hydrogen/src/db/schemas/*',
  out: './lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: environmentConfig.hydrogen.host,
    port: environmentConfig.hydrogen.port,
    user: environmentConfig.hydrogen.user,
    password: environmentConfig.hydrogen.password,
    database: environmentConfig.hydrogen.database,
  },
} satisfies Config;
