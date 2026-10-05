import { Controller, Inject } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { DEFAULT_QUEUE_CONFIG } from '@libs/queue';
import { clipperRootRouter } from '@projects/clipper-contracts';
import { CLIPPER_QUEUE_CONFIG, type ClipperQueue } from '../../queue/queue';

const clipsV1Router = clipperRootRouter.v1.clips;

@Controller()
export class ClipsController {
  constructor(
    @Inject(CLIPPER_QUEUE_CONFIG.processClip.queueName)
    private readonly processClipQueue: ClipperQueue<'processClip'>,
  ) {}

  @TsRestHandler(clipsV1Router.processClips)
  public processClips() {
    return tsRestHandler(clipsV1Router.processClips, async ({ body }) => {
      await this.processClipQueue.addBulk(
        body.keys.map((key) => ({
          name: CLIPPER_QUEUE_CONFIG.processClip.jobName,
          data: { key },
          DEFAULT_QUEUE_CONFIG,
        })),
      );
      return { status: 200, body: 'ok' };
    });
  }
}
