import { Module } from '@nestjs/common';
import { TrackedWordsCommands } from './tracked-words.commands';
import { TrackedWordsService } from './tracked-words.service';

@Module({
  providers: [TrackedWordsService, TrackedWordsCommands],
  exports: [TrackedWordsService],
})
export class TrackedWordsModule {}
