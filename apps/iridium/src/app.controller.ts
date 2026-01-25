import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@wuguishifu/nest-common';

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get(['/', '/favicon.ico'])
  rootEndpoint() {
    return {
      status: 200,
    };
  }

  @Get('api/version')
  getVersion() {
    return {
      status: 200,
      version: this.configService.version,
    };
  }
}
