import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { UNIVERSE_DB } from '../../constants';
import { getDbClient } from '../../utils';

import { DB_CONFIG, type DbConfig } from './config';

export type UniverseDb = PostgresJsDatabase;

export type UniverseDbModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: never[]) => DbConfig | Promise<DbConfig>;
};

@Module({})
export class UniverseDbModule {
  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: UniverseDbModuleAsyncOptions): DynamicModule {
    return {
      module: UniverseDbModule,
      global: true,
      imports,
      providers: [
        { provide: DB_CONFIG, inject, useFactory },
        {
          provide: UNIVERSE_DB,
          inject: [DB_CONFIG],
          useFactory: (config: DbConfig) =>
            getDbClient({
              connectionString: config.connectionString,
            }),
        },
      ],
      exports: [UNIVERSE_DB],
    };
  }

  static forRoot(config: DbConfig): DynamicModule {
    return {
      global: true,
      module: UniverseDbModule,
      providers: [
        {
          provide: UNIVERSE_DB,
          useFactory: () =>
            getDbClient({
              connectionString: config.connectionString,
            }),
        },
      ],
      exports: [UNIVERSE_DB],
    };
  }
}
