import { Module } from '@nestjs/common';

import { FFmpegModule } from '../ffmpeg/ffmpeg.module';
import { WhisperModule } from '../whisper/whisper.module';

import { OrchestratorService } from './orchestrator.service';


@Module({
  imports: [FFmpegModule, WhisperModule],
  providers: [OrchestratorService],
})
export class OrchestratorModule {}
