import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Queue } from 'bullmq';
import { z } from 'zod';

import { TokenAuthGuard } from '../../auth/token-auth.guard';
import {
  derivativeKindSchema,
  JANKTM_QUEUE_CONFIG,
  type JanktmJobData,
} from '../../queues/queue';
import { jobStatus } from '../common/job-status';

const reprocessBodySchema = z
  .object({
    itemIds: z.array(z.string().min(1)).min(1).max(500).optional(),
    /** An album's slug. */
    album: z.string().min(1).optional(),
    kind: z.enum(['photo', 'video']).optional(),
    /** Everything; required to select everything, so an empty body can't. */
    all: z.literal(true).optional(),
    /** Only these (that apply to each item); default all. */
    derivatives: z.array(derivativeKindSchema).min(1).optional(),
  })
  .strict()
  .refine((body) => body.itemIds || body.album || body.kind || body.all, {
    message: 'Select items with itemIds, album, kind, or all: true',
  })
  .refine((body) => !(body.itemIds && (body.album || body.kind || body.all)), {
    message: 'itemIds selects items on its own',
  });

type ReprocessQueue = Queue<JanktmJobData<'reprocess'>>;

@UseGuards(TokenAuthGuard)
@Controller('api/items')
export class ItemsController {
  constructor(
    @Inject(JANKTM_QUEUE_CONFIG.reprocess.queueName)
    private readonly queue: ReprocessQueue,
  ) {}

  /**
   * Regenerates the selected items' derivatives (e.g. after changing the presets). Runs as a job;
   * follow it at `GET /api/items/reprocess/:id`.
   */
  @Post('reprocess')
  @HttpCode(202)
  public async reprocess(@Body() body: unknown) {
    const parsed = reprocessBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(z.prettifyError(parsed.error));
    }
    const { itemIds, album, kind, all, derivatives } = parsed.data;
    const job = await this.queue.add(
      JANKTM_QUEUE_CONFIG.reprocess.jobName,
      {
        selector: itemIds ? { itemIds } : { album, kind, all },
        derivatives,
      },
      { jobId: `reprocess-${Date.now()}` },
    );
    return { reprocessId: job.id };
  }

  @Get('reprocess/:id')
  public async status(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`No reprocess ${id}`);
    return await jobStatus(job);
  }
}
