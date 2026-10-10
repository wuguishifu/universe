import { Module } from '@nestjs/common';
import { registerQueue } from '../../queue/queue';
import { AnalysisModule } from '../analysis/analysis.module';
import { FFmpegModule } from '../ffmpeg/ffmpeg.module';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { PreprocessClipProcessor } from './processors/preprocess-clip.processor';
import { ProcessTranscriptProcessor } from './processors/process-transcript.processor';

@Module({
  imports: [
    registerQueue('processTranscripts'),
    registerQueue('preprocessClip'),
    AnalysisModule,
    FFmpegModule,
  ],
  controllers: [ClipsController],
  providers: [
    ClipsService,
    ProcessTranscriptProcessor,
    PreprocessClipProcessor,
  ],
})
export class ClipsModule {}
