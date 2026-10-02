import { Global, Module } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { RedisService } from './redis.service';
import { TranscriptionClientService } from './transcription-client.service';

@Global()
@Module({
  providers: [ConvexService, RedisService, TranscriptionClientService],
  exports: [ConvexService, RedisService, TranscriptionClientService],
})
export class CommonModule {}
