import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { osmiumRootRouter } from '@wuguishifu/contracts-osmium';

import { BearerAuthGuard } from '../../auth/guards/bearer-auth.guard';

@Controller()
export class TrackingController {
  @UseGuards(BearerAuthGuard)
  @TsRestHandler(osmiumRootRouter.v1.tracking.trackEvent)
  public trackEvent() {
    return tsRestHandler(osmiumRootRouter.v1.tracking.trackEvent, async ({ body }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      console.log(body);
      return {
        status: 200,
        body: { status: 'ok' },
      };
    });
  }
}
