import { Module } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [CacheModule, PriceModule],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
