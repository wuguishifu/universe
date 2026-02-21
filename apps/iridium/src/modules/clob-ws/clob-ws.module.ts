import { Module } from '@nestjs/common';

import { AuthModule } from '@wuguishifu/nest-polymarket';

import { MarketWsService } from './market-ws.service';
import { UserWsService } from './user-ws.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule, AuthModule],
  providers: [MarketWsService, UserWsService],
  exports: [MarketWsService, UserWsService],
})
export class ClobWsModule {}
