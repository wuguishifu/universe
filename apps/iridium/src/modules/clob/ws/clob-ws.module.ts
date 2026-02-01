import { Module } from '@nestjs/common';

import { ClobWsService } from './clob-ws.service';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [ClobWsService],
  exports: [ClobWsService],
})
export class ClobWsModule {}
