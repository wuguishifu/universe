import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { RelayerService } from './relayer.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [ExecutionService, RelayerService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
