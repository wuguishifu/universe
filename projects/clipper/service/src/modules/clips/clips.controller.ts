import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { clipperRootRouter } from '@projects/clipper-contracts';
import { ClipsService } from './clips.service';

const clipsV1Router = clipperRootRouter.v1.clips;

@Controller()
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @TsRestHandler(clipsV1Router.processClips)
  public processClips() {
    return tsRestHandler(clipsV1Router.processClips, async ({ body }) => {
      await this.clipsService.processClips(body);
      return { status: 200, body: 'ok' };
    });
  }
}
