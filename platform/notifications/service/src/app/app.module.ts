import { Module } from '@nestjs/common';

import { BullRootModule } from '@libs/queue';
import { NOTIFICATIONS_QUEUE_PREFIX } from '@platform/notifications-contracts';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { CommonModule } from '../modules/common/common.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    BullRootModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        redisUrl: env.environment.redisUrl,
        prefix: NOTIFICATIONS_QUEUE_PREFIX,
      }),
    }),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
