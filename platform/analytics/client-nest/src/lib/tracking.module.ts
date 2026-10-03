import { DynamicModule, Global, Module } from '@nestjs/common';
import { z } from 'zod';

import { TrackingConfig } from './config';
import { TRACKING_CONFIG } from './constants';
import { TrackingService } from './tracking.service';

const environmentSchema = z.object({
  OSMIUM_BASE_URL: z.string(),
  OSMIUM_ADMIN_TOKEN: z.string(),
});

@Global()
@Module({})
export class OsmiumModule {
  static register(
    config: Omit<
      TrackingConfig,
      'analyticsServiceBaseUrl' | 'analyticsServiceApiToken'
    >,
    key: string,
  ): DynamicModule {
    const parsed = environmentSchema.parse(process.env);

    return {
      module: OsmiumModule,
      providers: [
        TrackingService,
        {
          provide: TRACKING_CONFIG,
          useValue: {
            ...config,
            osmiumBaseUrl: parsed.OSMIUM_BASE_URL,
            osmiumApiAccessKey: parsed.OSMIUM_ADMIN_TOKEN,
          },
        },
        {
          provide: key,
          useExisting: TrackingService,
        },
      ],
      exports: [TrackingService, key],
    };
  }
}
