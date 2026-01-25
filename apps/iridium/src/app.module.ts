import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter, CommonModule, HealthController } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';

@Module({
  imports: [CommonModule],
  controllers: [AppController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
