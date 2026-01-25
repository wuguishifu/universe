import { Global, Module } from '@nestjs/common';

import { ConfigService, HttpService } from './services';

@Global()
@Module({
  providers: [ConfigService, HttpService],
  exports: [ConfigService, HttpService],
})
export class CommonModule {}
