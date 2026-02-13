import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { MarketAdapterService } from '../market-adapter/market-adapter.service';

@Module({
  imports: [CacheModule, ClobWsModule, MarketAdapterService],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
