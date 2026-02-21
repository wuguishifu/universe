import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob-ws/clob-ws.module';
import { MarketAdapterModule } from '../market-adapter/market-adapter.module';
import { PositionModule } from '../position/position.module';

@Module({
  imports: [CacheModule, ClobWsModule, MarketAdapterModule, PositionModule],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
