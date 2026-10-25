import { Module } from '@nestjs/common';

import { BullQueueModule } from '@libs/queue';
import { NOTIFICATIONS_QUEUE_CONFIG } from '@platform/notifications-contracts';

import { CheckReceiptsProcessor } from './check-receipts.processor';
import { ExpoPushService } from './expo-push.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SendNotificationProcessor } from './send-notification.processor';

@Module({
  imports: [
    BullQueueModule.register(NOTIFICATIONS_QUEUE_CONFIG, 'send'),
    BullQueueModule.register(NOTIFICATIONS_QUEUE_CONFIG, 'checkReceipts'),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ExpoPushService,
    SendNotificationProcessor,
    CheckReceiptsProcessor,
  ],
})
export class NotificationsModule {}
