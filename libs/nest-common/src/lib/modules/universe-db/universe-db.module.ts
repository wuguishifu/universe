import { DynamicModule, Module } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import { UNIVERSE_DB } from '../../constants';
import { getDbClient } from '../../utils';

export type UniverseDb = PostgresJsDatabase;

const environmentSchema = z.object({
  UNIVERSE_DB_CONNECTION_STRING: z.string(),
});

@Module({})
export class UniverseDbModule {
  static register(): DynamicModule {
    const parsed = environmentSchema.parse(process.env);

    return {
      module: UniverseDbModule,
      providers: [
        {
          provide: UNIVERSE_DB,
          useFactory: () =>
            getDbClient({
              connectionString: parsed.UNIVERSE_DB_CONNECTION_STRING,
            }),
        },
      ],
      exports: [UNIVERSE_DB],
    };
  }
}
