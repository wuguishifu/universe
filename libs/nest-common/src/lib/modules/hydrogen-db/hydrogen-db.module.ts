import { DynamicModule, Global, Module } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import { HYDROGEN_DB } from '../../constants';
import { getDbClient } from '../../utils';

export type HydrogenDb = PostgresJsDatabase;

const environmentSchema = z.object({
  HYDROGEN_DATABASE: z.string(),
  HYDROGEN_HOST: z.string(),
  HYDROGEN_PASSWORD: z.string(),
  HYDROGEN_PORT: z.coerce.number(),
  HYDROGEN_USER: z.string(),
});

@Global()
@Module({})
export class HydrogenDbModule {
  static register(): DynamicModule {
    const parsed = environmentSchema.parse(process.env);

    return {
      module: HydrogenDbModule,
      providers: [
        {
          provide: HYDROGEN_DB,
          useFactory: () =>
            getDbClient({
              dbConfig: {
                database: parsed.HYDROGEN_DATABASE,
                host: parsed.HYDROGEN_HOST,
                password: parsed.HYDROGEN_PASSWORD,
                port: parsed.HYDROGEN_PORT,
                user: parsed.HYDROGEN_USER,
              },
            }),
        },
      ],
      exports: [HYDROGEN_DB],
    };
  }
}
