import { Provider } from '@nestjs/common';
import { environmentConfig } from '@wuguishifu/environment';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { HYDROGEN_DB } from '../constants';
import { getDbClient } from '../utils';

export type HydrogenDb = PostgresJsDatabase;

export const HydrogenDbProvider: Provider = {
  provide: HYDROGEN_DB,
  useFactory: () =>
    getDbClient({
      dbConfig: {
        database: environmentConfig.hydrogen.database,
        host: environmentConfig.hydrogen.host,
        password: environmentConfig.hydrogen.password,
        port: environmentConfig.hydrogen.port,
        user: environmentConfig.hydrogen.user,
      },
      environment: environmentConfig.environmentKey,
    }),
};
