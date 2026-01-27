import { Module } from '@nestjs/common';

import { PriceService } from './price.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
