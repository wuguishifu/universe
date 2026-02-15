import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { CacheModule } from '../cache/cache.module';
import { ClobClientModule } from '../clob/client/clob-client.module';

@Module({
  imports: [CacheModule, ClobClientModule],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
