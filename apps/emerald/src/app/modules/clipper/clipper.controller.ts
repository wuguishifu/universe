import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { emeraldRootRouter } from '@universe/contracts-emerald';
import { TokenAuthGuard } from '../../../auth/guards/token-auth.guard';
import { ClipperService } from './clipper.service';

@UseGuards(TokenAuthGuard('emeraldAdminToken'))
@Controller()
export class ClipperController {
  constructor(private readonly clipperService: ClipperService) {}

  @TsRestHandler(emeraldRootRouter.clipper.queue)
  public Queue() {
    return tsRestHandler(emeraldRootRouter.clipper.queue, async ({ body }) => {
      await this.clipperService.queueJob(body);
      return { status: 200, body: 'ok' };
    });
  }
}
