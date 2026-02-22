import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob-ws/clob-ws.module';
import { MarketAdapterModule } from '../market-adapter/market-adapter.module';

@Module({
  imports: [CacheModule, ClobWsModule, MarketAdapterModule],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
