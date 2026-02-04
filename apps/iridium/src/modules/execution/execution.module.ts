import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { RelayerService } from './relayer.service';
import { CacheModule } from '../cache/cache.module';
import { ClobClientModule } from '../clob/client/clob-client.module';

@Module({
  imports: [CacheModule, ClobClientModule],
  providers: [ExecutionService, RelayerService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
