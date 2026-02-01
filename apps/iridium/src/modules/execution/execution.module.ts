import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
