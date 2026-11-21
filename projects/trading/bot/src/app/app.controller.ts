import { Controller, Get } from '@nestjs/common';

import { BotService } from '../bot/bot.service';
import { EnvironmentService } from '../config/environment';

@Controller()
export class AppController {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly botService: BotService,
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
    return { status: 200 };
  }

  /** What the bot holds and how its data looks right now. */
  @Get('api/status')
  getStatus() {
    return this.botService.status();
  }
}
