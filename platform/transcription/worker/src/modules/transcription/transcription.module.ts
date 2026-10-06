import { Module } from '@nestjs/common';
import { BullQueueModule } from '@libs/queue';
import { TRANSCRIPTION_QUEUE_CONFIG } from '@platform/transcription-contracts';
import { FilesService } from './files.service';
import { ModelsService } from './models.service';
import { TranscriptionProcessor } from './transcription.processor';

@Module({
  imports: [BullQueueModule.register(TRANSCRIPTION_QUEUE_CONFIG, 'transcribe')],
  providers: [TranscriptionProcessor, FilesService, ModelsService],
})
export class TranscriptionModule {}
