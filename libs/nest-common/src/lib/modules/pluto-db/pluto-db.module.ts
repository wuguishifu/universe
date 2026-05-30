import { DynamicModule, Global, Module } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import { PLUTO_DB } from '../../constants';
import { getDbClient } from '../../utils';

export type PlutoDb = PostgresJsDatabase;

const environmentSchema = z.object({
  PLUTO_DATABASE: z.string(),
  PLUTO_HOST: z.string(),
  PLUTO_PASSWORD: z.string(),
  PLUTO_PORT: z.coerce.number(),
  PLUTO_USER: z.string(),
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
              dbConfig: {
                database: parsed.PLUTO_DATABASE,
                host: parsed.PLUTO_HOST,
                password: parsed.PLUTO_PASSWORD,
                port: parsed.PLUTO_PORT,
                user: parsed.PLUTO_USER,
              },
            }),
        },
      ],
      exports: [PLUTO_DB],
    };
  }
}
