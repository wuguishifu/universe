import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { ConverterModule } from '../modules/converter/converter.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, ConverterModule, QueueModule],
  controllers: [AppController],
})
export class AppModule {}
