import { Module } from '@nestjs/common';

import { ProcessingModule } from '../processing/processing.module';

import { MetadataService } from './metadata.service';
import { ScanProcessor } from './scan.processor';
import { ScansController } from './scans.controller';

@Module({
  imports: [ProcessingModule],
  controllers: [ScansController],
  providers: [MetadataService, ScanProcessor],
})
export class ScanModule {}
