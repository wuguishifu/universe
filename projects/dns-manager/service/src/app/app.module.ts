import { Module } from '@nestjs/common';

import { EnvironmentModule } from '../config/environment';
import { SyncModule } from '../modules/sync/sync.module';

import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, SyncModule],
  controllers: [AppController],
})
export class AppModule {}
