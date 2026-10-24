import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';

import { REDIS_CACHE_OPTIONS, RedisCacheOptions } from './redis-cache';
import { RedisCacheService } from './redis-cache.service';

export type RedisCacheModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (
    ...args: never[]
  ) => RedisCacheOptions | Promise<RedisCacheOptions>;
};

@Module({})
export class RedisCacheModule {
  public static forRoot(options: RedisCacheOptions): DynamicModule {
    return {
      module: RedisCacheModule,
      global: true,
      providers: [
        { provide: REDIS_CACHE_OPTIONS, useValue: options },
        RedisCacheService,
      ],
      exports: [RedisCacheService],
    };
  }

  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: RedisCacheModuleAsyncOptions): DynamicModule {
    return {
      module: RedisCacheModule,
      global: true,
      imports,
      providers: [
        { provide: REDIS_CACHE_OPTIONS, inject, useFactory },
        RedisCacheService,
      ],
      exports: [RedisCacheService],
    };
  }
}
