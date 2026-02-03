import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { osmiumRootRouter } from '@wuguishifu/contracts-osmium';

import { TrackingService } from './tracking.service';
import { BearerAuthGuard } from '../../auth/guards/bearer-auth.guard';

@Controller()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @UseGuards(BearerAuthGuard)
  @TsRestHandler(osmiumRootRouter.v1.tracking.trackEvent)
  public trackEvent() {
    return tsRestHandler(osmiumRootRouter.v1.tracking.trackEvent, async ({ body }) => {
      await this.trackingService.trackEvent(body);
      return {
        status: 200,
        body: { status: 'ok' },
      };
    });
  }

  @UseGuards(BearerAuthGuard)
  @TsRestHandler(osmiumRootRouter.v1.tracking.trackEventBatch)
  public trackEventBatch() {
    return tsRestHandler(osmiumRootRouter.v1.tracking.trackEventBatch, async ({ body }) => {
      await this.trackingService.trackEventBatch(body);
      return {
        status: 200,
        body: { status: 'ok' },
      };
    });
  }
}
