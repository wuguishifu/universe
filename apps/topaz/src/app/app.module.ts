import { Module } from '@nestjs/common';

import { HealthController } from '@universe/nest-common';

import { EnvironmentModule } from '../environment/environment-module';

import { AppController } from './app.controller';
import { MonitorModule } from './modules/monitor/monitor.module';

@Module({
  imports: [EnvironmentModule, MonitorModule],
  controllers: [HealthController, AppController],
})
export class AppModule {}
