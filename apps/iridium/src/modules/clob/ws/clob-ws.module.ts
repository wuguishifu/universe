import { Module } from '@nestjs/common';

import { MarketWsService } from './market-ws.service';
import { UserWsService } from './user-ws.service';
import { AuthModule } from '../../auth/auth.module';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [CacheModule, AuthModule],
  providers: [MarketWsService, UserWsService],
  exports: [MarketWsService, UserWsService],
})
export class ClobWsModule {}
