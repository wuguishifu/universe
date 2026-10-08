import { Module } from '@nestjs/common';
import { registerQueue } from '../../queue/queue';
import { AnalysisModule } from '../analysis/analysis.module';
import { ClipsQueueProcessor } from './clips-queue.processor';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [registerQueue('processTranscript'), AnalysisModule],
  controllers: [ClipsController],
  providers: [ClipsService, ClipsQueueProcessor],
})
export class ClipsModule {}
