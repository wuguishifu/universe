import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment';
import { BullOptionsFactory, registerQueue } from './queues';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [EnvironmentModule],
      useClass: BullOptionsFactory,
    }),
    // Global: the API adds to it and the worker processes it.
    registerQueue('download'),
  ],
})
export class QueueModule {}
