import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { analyticsRootRouter } from '@platform/analytics-contracts';

import { TokenAuthGuard } from '../../auth/guards/token-auth.guard';

import { TrackingService } from './tracking.service';

@UseGuards(TokenAuthGuard('apiToken'))
@Controller()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @TsRestHandler(analyticsRootRouter.tracking.trackEvent)
  public trackEvent() {
    return tsRestHandler(
      analyticsRootRouter.tracking.trackEvent,
      async ({ body }) => {
        await this.trackingService.trackEvent(body);
        return {
          status: 200,
          body: { status: 'ok' },
        };
      },
    );
  }

  @TsRestHandler(analyticsRootRouter.tracking.trackEventBatch)
  public trackEventBatch() {
    return tsRestHandler(
      analyticsRootRouter.tracking.trackEventBatch,
      async ({ body }) => {
        await this.trackingService.trackEventBatch(body);
        return {
          status: 200,
          body: { status: 'ok' },
        };
      },
    );
  }
}
