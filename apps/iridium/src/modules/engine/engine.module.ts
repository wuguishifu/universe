import { Module } from '@nestjs/common';

import { EngineService } from './engine.service';
import { CacheModule } from '../cache/cache.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [CacheModule, ExecutionModule],
  providers: [EngineService],
})
export class EngineModule {}
