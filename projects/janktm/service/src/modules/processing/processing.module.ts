import { Module } from '@nestjs/common';

import { CompleteItemProcessor } from './complete-item.processor';
import { ItemsController } from './items.controller';
import { ProcessingService } from './processing.service';
import { ReprocessProcessor } from './reprocess.processor';

@Module({
  controllers: [ItemsController],
  providers: [ProcessingService, CompleteItemProcessor, ReprocessProcessor],
  exports: [ProcessingService],
})
export class ProcessingModule {}
