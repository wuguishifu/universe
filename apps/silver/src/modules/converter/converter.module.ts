import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { ConverterController } from './converter.controller';
import { ConverterService } from './converter.service';

@Module({
  imports: [S3Module],
  providers: [ConverterService],
  controllers: [ConverterController],
})
export class ConverterModule {}
