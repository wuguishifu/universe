import { Module } from '@nestjs/common';

import { HealthController, PlutoDbModule } from '@universe/nest-common';

import { EnvironmentModule } from './environment/environment-module';
import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [PlutoDbModule.register(), EnvironmentModule, TrackingModule],
  controllers: [HealthController],
})
export class AppModule {}
