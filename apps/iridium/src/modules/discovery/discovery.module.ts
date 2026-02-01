import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob/ws/clob-ws.module';

@Module({
  imports: [CacheModule, ClobWsModule],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
