import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClipperQueueModule } from './clipper/clipper-queue.module';
import { BullOptionsFactory } from './queue-options';

@Module({
  imports: [
    BullModule.forRootAsync({
      useClass: BullOptionsFactory,
    }),
    ClipperQueueModule,
  ],
})
export class QueueModule {}
