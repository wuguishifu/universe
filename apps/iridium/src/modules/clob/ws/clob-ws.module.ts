import { Module } from '@nestjs/common';

import { ClobWsService } from './clob-ws.service';

@Module({
  providers: [ClobWsService],
  exports: [ClobWsService],
})
export class ClobWsModule {}
