import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnalyzeClipProcessor } from './analyze-clip.processor';
import { GeminiService } from './gemini.service';
import { MediaService } from './media.service';

@Module({
  providers: [
    AnalyzeClipProcessor,
    AnalysisService,
    GeminiService,
    MediaService,
  ],
})
export class AnalysisModule {}
