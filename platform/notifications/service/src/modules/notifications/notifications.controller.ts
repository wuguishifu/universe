import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { notificationsRootRouter } from '@platform/notifications-contracts';

import { TokenAuthGuard } from '../../auth/guards/token-auth.guard';

import { NotificationsService } from './notifications.service';

/** For callers outside the cluster, which can't reach Redis. Ends up on the same queue. */
@UseGuards(TokenAuthGuard('apiToken'))
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @TsRestHandler(notificationsRootRouter.notifications.send)
  public send() {
    return tsRestHandler(
      notificationsRootRouter.notifications.send,
      async ({ body: { idempotencyKey, ...data } }) => {
        const jobId = await this.notificationsService.enqueue(
          data,
          idempotencyKey,
        );
        return {
          status: 202,
          body: { jobId },
        };
      },
    );
  }
}
