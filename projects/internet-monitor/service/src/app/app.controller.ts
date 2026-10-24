import { Controller, Get } from '@nestjs/common';

import { EnvironmentService } from '../config/environment';

@Controller()
export class AppController {
  constructor(private readonly environmentService: EnvironmentService) {}

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
}
