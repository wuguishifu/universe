import { DynamicModule, Global, Module } from '@nestjs/common';
import { z } from 'zod';

import { OsmiumConfig, OsmiumService } from './osmium.service';
import { OSMIUM_CONFIG } from '../../constants';

const environmentSchema = z.object({
  OSMIUM_BASE_URL: z.string(),
  OSMIUM_API_ACCESS_KEY: z.string(),
});

@Global()
@Module({})
export class OsmiumModule {
  static register(config: Omit<OsmiumConfig, 'osmiumBaseUrl' | 'osmiumApiAccessKey'>, key: string): DynamicModule {
    const parsed = environmentSchema.parse(process.env);

    return {
      module: OsmiumModule,
      providers: [
        OsmiumService,
        {
          provide: OSMIUM_CONFIG,
          useValue: {
            ...config,
            osmiumBaseUrl: parsed.OSMIUM_BASE_URL,
            osmiumApiAccessKey: parsed.OSMIUM_API_ACCESS_KEY,
          },
        },
        {
          provide: key,
          useExisting: OsmiumService,
        },
      ],
      exports: [OsmiumService, key],
    };
  }
}
