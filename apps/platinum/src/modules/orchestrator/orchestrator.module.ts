import { Module } from '@nestjs/common';

import { OrchestratorService } from './orchestrator.service';
import { DataModule } from '../data/data.module';
import { MergeModule } from '../merge/merge.module';

@Module({
  imports: [DataModule, MergeModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
