import { WorkerHost } from '@nestjs/bullmq';
import type { FunctionReturnType } from 'convex/server';

import { UniverseProcessor } from '@libs/queue';
import { api } from '@platform/convex-contracts';

import { JANKTM_QUEUE_CONFIG, type JanktmJob } from '../../queues/queue';
import { ConvexService } from '../common/convex.service';
import { withoutUndefined } from '../common/without-undefined';

import { ProcessingService } from './processing.service';

type ReprocessPage = FunctionReturnType<
  typeof api.album.processing.selectForReprocess
>;

/** Items given new jobs per Convex call. */
const PAGE_SIZE = 100;

/** Gives the selected items new jobs, a page at a time, and queues them. */
@UniverseProcessor(JANKTM_QUEUE_CONFIG, 'reprocess')
export class ReprocessProcessor extends WorkerHost {
  constructor(
    private readonly convex: ConvexService,
    private readonly processing: ProcessingService,
  ) {
    super();
  }

  override async process(
    job: JanktmJob<'reprocess'>,
  ): Promise<{ queued: number }> {
    const { selector, derivatives } = job.data;
    const convexSelector =
      'itemIds' in selector
        ? { itemIds: selector.itemIds }
        : {
            albumSlug: selector.album,
            kind: selector.kind,
            all: selector.all,
          };
    let queued = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: ReprocessPage = await this.convex.mutation(
        api.album.processing.selectForReprocess,
        {
          selector: withoutUndefined(convexSelector),
          derivatives,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        },
      );
      queued += await this.processing.enqueue(page.toQueue);
      await job.updateProgress({ queued });
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { queued };
  }
}
