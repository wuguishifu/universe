import { Module } from '@nestjs/common';

import { EngineService } from './engine.service';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [ExecutionModule],
  providers: [EngineService],
})
export class EngineModule {}
