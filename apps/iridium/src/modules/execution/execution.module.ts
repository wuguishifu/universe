import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { CacheModule } from '../cache/cache.module';
import { RelayerModule } from '../relayer/relayer.module';

@Module({
  imports: [CacheModule, RelayerModule],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
