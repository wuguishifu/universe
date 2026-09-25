import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { BullOptionsFactory } from './queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [EnvironmentModule],
      useClass: BullOptionsFactory,
    }),
  ],
})
export class QueueModule {}
