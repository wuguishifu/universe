import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { S3Module } from '../s3/s3.module';
import { YtDlpModule } from '../ytdlp/ytdlp.module';
import { ConverterQueueProcessor } from './converter-queue.processor';
import { ConverterController } from './converter.controller';
import { ConverterService } from './converter.service';

@Module({
  imports: [S3Module, YtDlpModule, registerQueue('youtubeConverter')],
  providers: [ConverterService, ConverterQueueProcessor],
  controllers: [ConverterController],
})
export class ConverterModule {}
