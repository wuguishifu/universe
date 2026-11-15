import { Controller, Get } from '@nestjs/common';

import { EnvironmentService } from '../config/environment';
import { SyncService } from '../modules/sync/sync.service';

@Controller()
export class AppController {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly syncService: SyncService,
  ) {}

  @Get('api/version')
  getVersion() {
    return {
      status: 200,
      version: this.environmentService.environment.version,
      versionTag: this.environmentService.environment.versionTag,
      environment: this.environmentService.environment.environment,
    };
  }

  @Get('api/health')
  getHealth() {
    return {
      status: 200,
    };
  }

  /** The records it manages, what it skipped and why, and the last sync's outcome. */
  @Get('api/status')
  getStatus() {
    return this.syncService.getStatus();
  }
}
