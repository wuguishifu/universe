import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { EnvironmentModule } from '../config/environment';
import { CommonModule } from '../modules/common/common.module';
import { ItemsModule } from '../modules/items/items.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    ScheduleModule.forRoot(),
    CommonModule,
    ItemsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
