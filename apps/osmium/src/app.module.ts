import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { GlobalModule } from './modules/global.module';
import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [AuthModule, CommonModule, GlobalModule, TrackingModule],
  controllers: [AppController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
