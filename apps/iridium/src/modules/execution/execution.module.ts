import { Module } from '@nestjs/common';

import { ExecutionService } from './execution.service';
import { RelayerService } from './relayer.service';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule, AuthModule],
  providers: [ExecutionService, RelayerService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
