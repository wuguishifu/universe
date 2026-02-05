import { DynamicModule, Global, Module } from '@nestjs/common';

import { OsmiumConfig, OsmiumService } from './osmium.service';
import { OSMIUM_CONFIG } from '../../constants';

@Global()
@Module({})
export class OsmiumModule {
  static register(config: OsmiumConfig, key: string): DynamicModule {
    return {
      module: OsmiumModule,
      providers: [
        OsmiumService,
        {
          provide: OSMIUM_CONFIG,
          useValue: config,
        },
        {
          provide: key,
          useExisting: OsmiumService,
        },
      ],
      exports: [key],
    };
  }
}
