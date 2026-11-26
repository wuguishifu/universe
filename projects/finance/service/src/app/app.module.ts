import { Module } from '@nestjs/common';

import { EnvironmentModule } from '../config/environment';
import { CommonModule } from '../modules/common/common.module';
import { ItemsModule } from '../modules/items/items.module';

import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, CommonModule, ItemsModule],
  controllers: [AppController],
})
export class AppModule {}
