import { Module } from '@nestjs/common';

import { ClobClientModule } from '@wuguishifu/nest-polymarket';

import { ExecutionService } from './execution.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule, ClobClientModule],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
