import { Module } from '@nestjs/common';

import { RecordingsService } from './recordings.service';

@Module({
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
