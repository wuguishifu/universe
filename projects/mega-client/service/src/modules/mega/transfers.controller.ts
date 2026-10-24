import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { megaRootRouter } from '@projects/mega-client-contracts';

import { LiveService } from './live.service';
import { TransfersService } from './transfers.service';

@Controller()
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly liveService: LiveService,
  ) {}

  @TsRestHandler(megaRootRouter.transfers)
  public handler() {
    const after = (change: () => Promise<unknown>) =>
      this.liveService.afterChange(change);

    return tsRestHandler(megaRootRouter.transfers, {
      queue: ({ body: { url } }) =>
        after(() => this.transfersService.queue(url)),
      pause: ({ params: { tag } }) =>
        after(() => this.transfersService.pause(tag)),
      resume: ({ params: { tag } }) =>
        after(() => this.transfersService.resume(tag)),
      cancel: ({ params: { tag } }) =>
        after(() => this.transfersService.cancel(tag)),
      pauseAll: () => after(() => this.transfersService.pauseAll()),
      resumeAll: () => after(() => this.transfersService.resumeAll()),
      cancelAll: () => after(() => this.transfersService.cancelAll()),
    });
  }
}
