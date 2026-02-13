import { Injectable, OnModuleInit } from '@nestjs/common';

import { OsmiumService } from '@wuguishifu/nest-common';

import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class StartupService implements OnModuleInit {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  onModuleInit() {
    this.osmiumService.trackEvent({
      name: 'iridium-started',
      metadata: { configuration: this.sanitizedEnvironment },
    });
  }

  private get sanitizedEnvironment() {
    const {
      privateKey,
      signatureType,
      funderAddress,
      polyApiKey,
      polyApiSecret,
      polyApiPassphrase,
      ...sanitizedEnvironment
    } = this.environmentService.environment;

    return sanitizedEnvironment;
  }
}
