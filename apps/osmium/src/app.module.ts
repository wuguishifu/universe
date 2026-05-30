import { Module } from '@nestjs/common';

import { HealthController, PlutoDbModule } from '@universe/nest-common';

import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [PlutoDbModule.register(), TrackingModule],
  controllers: [HealthController],
})
export class AppModule {}
