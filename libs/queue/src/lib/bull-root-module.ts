import { BullModule } from '@nestjs/bullmq';
import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';

import { createBullRootOptions } from './bull-root-options';

export type BullRootOptions = {
  redisUrl: string;
  /** Redis key prefix. Services that share queues must use the same one. */
  prefix: string;
};

export type BullRootModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: never[]) => BullRootOptions | Promise<BullRootOptions>;
};

const BULL_ROOT_OPTIONS = 'BULL_ROOT_OPTIONS';

@Module({})
export class BullRootModule {
  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: BullRootModuleAsyncOptions): DynamicModule {
    return BullModule.forRootAsync({
      imports: [
        {
          module: BullRootModule,
          imports,
          providers: [{ provide: BULL_ROOT_OPTIONS, inject, useFactory }],
          exports: [BULL_ROOT_OPTIONS],
        },
      ],
      inject: [BULL_ROOT_OPTIONS],
      useFactory: ({ redisUrl, prefix }: BullRootOptions) =>
        createBullRootOptions(redisUrl, prefix),
    });
  }
}
