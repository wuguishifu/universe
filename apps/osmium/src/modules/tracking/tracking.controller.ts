import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { osmiumRootRouter } from '@universe/contracts-osmium';

import { TokenAuthGuard } from '../../auth/guards/token-auth.guard';

import { TrackingService } from './tracking.service';

@UseGuards(TokenAuthGuard('osmiumAdminToken'))
@Controller()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @TsRestHandler(osmiumRootRouter.tracking.trackEvent)
  public trackEvent() {
    return tsRestHandler(
      osmiumRootRouter.tracking.trackEvent,
      async ({ body }) => {
        await this.trackingService.trackEvent(body);
        return {
          status: 200,
          body: { status: 'ok' },
        };
      },
    );
  }

  @TsRestHandler(osmiumRootRouter.tracking.trackEventBatch)
  public trackEventBatch() {
    return tsRestHandler(
      osmiumRootRouter.tracking.trackEventBatch,
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
