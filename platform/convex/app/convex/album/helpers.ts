import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import type { DerivativeKind, ItemKind } from './validators';

/** What an item gets: every kind gets stills, and anything that moves gets a hover loop. */
export function derivativesFor(
  kind: ItemKind,
  hasMotion: boolean,
): DerivativeKind[] {
  if (kind === 'video') return ['thumb', 'display', 'hover', 'preview'];
  return hasMotion ? ['thumb', 'display', 'hover'] : ['thumb', 'display'];
}

/** The album's first or last ready item by `takenAt`. */
export async function edgeReadyItem(
  ctx: QueryCtx,
  albumId: Id<'albumAlbums'>,
  order: 'asc' | 'desc',
): Promise<Doc<'albumItems'> | null> {
  return await ctx.db
    .query('albumItems')
    .withIndex('by_album_status_takenAt', (q) =>
      q.eq('albumId', albumId).eq('status', 'ready'),
    )
    .order(order)
    .first();
}

/**
 * Applies count changes to an album and recomputes its date range from its ready items. Call it
 * once per mutation, after the items have changed.
 */
export async function updateAlbumStats(
  ctx: MutationCtx,
  albumId: Id<'albumAlbums'>,
  delta: { items?: number; ready?: number } = {},
): Promise<void> {
  const album = await ctx.db.get('albumAlbums', albumId);
  if (!album) return;
  const [first, last] = await Promise.all([
    edgeReadyItem(ctx, albumId, 'asc'),
    edgeReadyItem(ctx, albumId, 'desc'),
  ]);
  await ctx.db.patch('albumAlbums', albumId, {
    itemCount: album.itemCount + (delta.items ?? 0),
    readyCount: album.readyCount + (delta.ready ?? 0),
    startAt: first?.takenAt,
    endAt: last?.takenAt,
  });
}

/** What janktm-service needs to build an item's ffmpeg job. */
export type JobInput = {
  itemId: Id<'albumItems'>;
  token: string;
  kind: ItemKind;
  original: Doc<'albumItems'>['original'];
  motion?: Doc<'albumItems'>['motion'];
  media: Doc<'albumItems'>['media'];
  derivatives: DerivativeKind[];
};

export function toJobInput(item: Doc<'albumItems'>): JobInput {
  if (!item.job) throw new Error(`Item ${item._id} has no job`);
  return {
    itemId: item._id,
    token: item.job.token,
    kind: item.kind,
    original: item.original,
    motion: item.motion,
    media: item.media,
    derivatives: item.job.derivatives,
  };
}

export function newJob(
  derivatives: DerivativeKind[],
): NonNullable<Doc<'albumItems'>['job']> {
  return {
    token: crypto.randomUUID(),
    state: 'queued',
    derivatives,
    queuedAt: Date.now(),
  };
}
