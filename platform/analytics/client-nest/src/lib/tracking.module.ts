import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';

import { TRACKING_CONFIG } from './constants';
import { TrackingService } from './tracking.service';

export type TrackingModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: never[]) => TrackingConfig | Promise<TrackingConfig>;
};

@Module({})
export class TrackingModule {
  public static forRoot(config: TrackingConfig): DynamicModule {
    return {
      module: TrackingModule,
      global: true,
      providers: [
        { provide: TRACKING_CONFIG, useValue: config },
        TrackingService,
      ],
      exports: [TrackingService],
    };
  }

  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: TrackingModuleAsyncOptions): DynamicModule {
    return {
      module: TrackingModule,
      global: true,
      imports,
      providers: [
        { provide: TRACKING_CONFIG, inject, useFactory },
        TrackingService,
      ],
      exports: [TrackingService],
    };
  }
}
