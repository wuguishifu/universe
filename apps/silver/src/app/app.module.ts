import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { CommonModule } from '../modules/common/common.module';
import { ConverterModule } from '../modules/converter/converter.module';
import { UrlModule } from '../modules/url/url.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    ConverterModule,
    UrlModule,
    QueueModule,
    CommonModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
