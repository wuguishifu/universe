import { Module } from '@nestjs/common';
import { S3Module } from '../s3/s3.module';
import { UrlController } from './url.controller';

@Module({
  imports: [S3Module],
  controllers: [UrlController],
})
export class UrlModule {}
