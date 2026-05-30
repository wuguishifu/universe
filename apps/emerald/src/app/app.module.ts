import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';
import { ClipperModule } from './modules/clipper/clipper.module';

@Module({
  imports: [EnvironmentModule, ClipperModule, QueueModule],
  controllers: [AppController],
})
export class AppModule {}
