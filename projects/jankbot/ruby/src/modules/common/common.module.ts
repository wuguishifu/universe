import { Global, Module } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { TranscriptionClientService } from './transcription-client.service';

@Global()
@Module({
  providers: [ConvexService, TranscriptionClientService],
  exports: [ConvexService, TranscriptionClientService],
})
export class CommonModule {}
