import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { clipperRootRouter } from '@projects/clipper-contracts';

import { TokenAuthGuard } from '../../auth/token-auth.guard';

import { ClipsService } from './clips.service';

@UseGuards(TokenAuthGuard('apiToken'))
@Controller()
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @TsRestHandler(clipperRootRouter.clips.uploadUrls)
  public uploadUrls() {
    return tsRestHandler(
      clipperRootRouter.clips.uploadUrls,
      async ({ body }) => ({
        status: 200,
        body: await this.clipsService.uploadUrls(body.clips),
      }),
    );
  }
}
