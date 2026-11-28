import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';

import { assertJanktmSecret, janktmSecret } from './auth';
import {
  derivativesFor,
  type JobInput,
  newJob,
  toJobInput,
  updateAlbumStats,
} from './helpers';
import {
  type Derivative,
  type DerivativeKind,
  type Derivatives,
  DERIVATIVE_KINDS,
  derivativeKind,
  derivatives,
  itemKind,
} from './validators';

/** Most items `selectForReprocess` takes by ID at once. */
const MAX_REPROCESS_IDS = 500;

/**
 * Saves a job's derivatives. A job whose token isn't the item's any more (the file changed or it
 * was reprocessed since) is stale: nothing is saved, and its outputs should be deleted.
 *
 * Returns the derivatives the new ones replaced, whose objects should be deleted too.
 */
export const completeItem = mutation({
  args: {
    secret: janktmSecret,
    itemId: v.id('albumItems'),
    token: v.string(),
    derivatives,
  },
  handler: async (ctx, { secret, itemId, token, derivatives: generated }) => {
    assertJanktmSecret(secret);
    const item = await ctx.db.get('albumItems', itemId);
    const replaced: Derivative[] = [];
    if (!item || item.job?.token !== token) {
      return { applied: false, replaced };
    }

    const merged: Derivatives = { ...item.derivatives };
    for (const kind of DERIVATIVE_KINDS) {
      const before = item.derivatives[kind];
      const after = generated[kind];
      if (!after) continue;
      merged[kind] = after;
      if (before && before.key !== after.key) replaced.push(before);
    }
    const ready = merged.thumb !== undefined;
    await ctx.db.patch('albumItems', itemId, {
      derivatives: merged,
      status: ready ? 'ready' : item.status,
      width: merged.display?.width ?? item.width,
      height: merged.display?.height ?? item.height,
      job: undefined,
    });
    await updateAlbumStats(ctx, item.albumId, {
      ready: ready && item.status !== 'ready' ? 1 : 0,
    });
    return { applied: true, replaced };
  },
});

/** Records a job's failure. A ready item stays listed with what it had. */
export const failItem = mutation({
  args: {
    secret: janktmSecret,
    itemId: v.id('albumItems'),
    token: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { secret, itemId, token, error }) => {
    assertJanktmSecret(secret);
    const item = await ctx.db.get('albumItems', itemId);
    if (!item?.job || item.job.token !== token) return { applied: false };
    await ctx.db.patch('albumItems', itemId, {
      status: item.status === 'ready' ? 'ready' : 'failed',
      job: { ...item.job, state: 'failed', error: error.slice(0, 4000) },
    });
    return { applied: true };
  },
});

/**
 * Gives the selected items new jobs and returns them to queue. Select by `itemIds` (one call), or
 * by `albumSlug` and/or `kind`, or `all`, a page at a time: call it again with `continueCursor`
 * until `isDone`. Items get the requested `derivatives` that apply to them (default: all).
 */
export const selectForReprocess = mutation({
  args: {
    secret: janktmSecret,
    selector: v.union(
      v.object({ itemIds: v.array(v.string()) }),
      v.object({
        albumSlug: v.optional(v.string()),
        kind: v.optional(itemKind),
        all: v.optional(v.literal(true)),
      }),
    ),
    derivatives: v.optional(v.array(derivativeKind)),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (
    ctx,
    { secret, selector, derivatives: requested, paginationOpts },
  ) => {
    assertJanktmSecret(secret);

    if ('itemIds' in selector) {
      if (selector.itemIds.length > MAX_REPROCESS_IDS) {
        throw new ConvexError({ code: 'too_many_items' as const });
      }
      const items: Doc<'albumItems'>[] = [];
      for (const rawId of selector.itemIds) {
        const id = ctx.db.normalizeId('albumItems', rawId);
        const item = id && (await ctx.db.get('albumItems', id));
        if (item) items.push(item);
      }
      const toQueue = await requeue(ctx, items, requested);
      return { toQueue, isDone: true, continueCursor: '' };
    }

    const { albumSlug, kind, all } = selector;
    if (!albumSlug && !kind && !all) {
      throw new ConvexError({ code: 'empty_selector' as const });
    }
    let albumId: Id<'albumAlbums'> | undefined;
    if (albumSlug) {
      const album = await ctx.db
        .query('albumAlbums')
        .withIndex('by_slug', (q) => q.eq('slug', albumSlug))
        .unique();
      if (!album) throw new ConvexError({ code: 'not_found' as const });
      albumId = album._id;
    }
    const page = await (
      albumId
        ? ctx.db
            .query('albumItems')
            .withIndex('by_album_path', (q) => q.eq('albumId', albumId))
        : ctx.db.query('albumItems')
    ).paginate(paginationOpts);
    const matching = page.page.filter((item) => !kind || item.kind === kind);
    const toQueue = await requeue(ctx, matching, requested);
    return {
      toQueue,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

async function requeue(
  ctx: MutationCtx,
  items: Doc<'albumItems'>[],
  requested: DerivativeKind[] | undefined,
): Promise<JobInput[]> {
  const toQueue: JobInput[] = [];
  for (const item of items) {
    const applicable = derivativesFor(item.kind, item.motion !== undefined);
    const kinds = requested
      ? applicable.filter((kind) => requested.includes(kind))
      : applicable;
    if (kinds.length === 0) continue;
    const job = newJob(kinds);
    await ctx.db.patch('albumItems', item._id, { job });
    toQueue.push(toJobInput({ ...item, job }));
  }
  return toQueue;
}
