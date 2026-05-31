import { DynamicModule, Global, Module } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import { PLUTO_DB } from '../../constants';
import { getDbClient } from '../../utils';

export type PlutoDb = PostgresJsDatabase;

const environmentSchema = z.object({
  PLUTO_DB_CONNECTION_STRING: z.string(),
});

@Global()
@Module({})
export class PlutoDbModule {
  static register(): DynamicModule {
    const parsed = environmentSchema.parse(process.env);

    return {
      module: PlutoDbModule,
      providers: [
        {
          provide: PLUTO_DB,
          useFactory: () =>
            getDbClient({
              connectionString: parsed.PLUTO_DB_CONNECTION_STRING,
            }),
        },
      ],
      exports: [PLUTO_DB],
    };
  }
}
