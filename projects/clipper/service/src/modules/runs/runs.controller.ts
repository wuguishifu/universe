import { Controller, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { clipperRootRouter } from '@projects/clipper-contracts';

import { TokenAuthGuard } from '../../auth/token-auth.guard';

import { RunsService } from './runs.service';

const notFound = (runId: string) =>
  ({ status: 404, body: { message: `No run ${runId}` } }) as const;

@UseGuards(TokenAuthGuard('apiToken'))
@Controller()
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @TsRestHandler(clipperRootRouter.runs)
  public handler() {
    return tsRestHandler(clipperRootRouter.runs, {
      create: async ({ body }) => ({
        status: 201,
        body: await this.runsService.create(body),
      }),
      addClips: async ({ params: { runId }, body }) => {
        const result = await this.runsService.addClips(runId, body.clips);
        if (result === 'not_found') return notFound(runId);
        if (result === 'cancelled') {
          return {
            status: 409,
            body: { message: `Run ${runId} was cancelled` },
          };
        }
        return { status: 200, body: result };
      },
      rerun: async ({ params: { runId }, body }) => {
        const result = await this.runsService.rerun(runId, body);
        if (result === 'not_found') return notFound(runId);
        return { status: 201, body: result };
      },
      get: async ({ params: { runId } }) => {
        const run = await this.runsService.get(runId);
        if (!run) return notFound(runId);
        return { status: 200, body: run };
      },
      clipJobs: async ({ params: { runId }, query }) => {
        const page = await this.runsService.clipJobs(runId, query);
        if (!page) return notFound(runId);
        return { status: 200, body: page };
      },
      cancel: async ({ params: { runId } }) => {
        const result = await this.runsService.cancel(runId);
        if (result === 'not_found') return notFound(runId);
        return { status: 200, body: result };
      },
    });
  }
}
