import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController, HydrogenDbModule } from '@wuguishifu/nest-common';

import { AuthModule } from './auth/auth.module';
import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [AuthModule, CommonModule, HydrogenDbModule.register(), TrackingModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
