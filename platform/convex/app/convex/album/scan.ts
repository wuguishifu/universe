import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query, type QueryCtx } from '../_generated/server';

import { assertJanktmSecret, janktmSecret } from './auth';
import {
  derivativesFor,
  type JobInput,
  newJob,
  toJobInput,
  updateAlbumStats,
} from './helpers';
import { slugify, uniqueSlug } from './slugs';
import {
  type S3Object,
  scannedItem,
  scannedItemWithMetadata,
} from './validators';

/**
 * A scan, as janktm-service runs it for each album folder:
 * 1. `beginAlbum` with the scan's start time, which every write of the scan stamps.
 * 2. For each batch of listed files, `diffItems` says which are new or changed; the service reads
 *    metadata for just those, then `upsertItems` saves the batch and returns the jobs to queue.
 * 3. `sweepItems` until it's done, to delete the album's items the scan didn't see.
 * A scan of every album then deletes the albums it didn't see: `staleAlbums`, then `sweepItems`
 * and `deleteAlbum` for each.
 */

/** Items deleted per `sweepItems` call. */
const SWEEP_BATCH = 200;

export const beginAlbum = mutation({
  args: { secret: janktmSecret, prefix: v.string(), scannedAt: v.number() },
  handler: async (ctx, { secret, prefix, scannedAt }) => {
    assertJanktmSecret(secret);
    const existing = await ctx.db
      .query('albumAlbums')
      .withIndex('by_prefix', (q) => q.eq('prefix', prefix))
      .unique();
    if (existing) {
      await ctx.db.patch('albumAlbums', existing._id, {
        lastSeenScanAt: scannedAt,
      });
      return { albumId: existing._id, slug: existing.slug, created: false };
    }
    const slug = await uniqueSlug(slugify(prefix), async (candidate) => {
      const taken = await ctx.db
        .query('albumAlbums')
        .withIndex('by_slug', (q) => q.eq('slug', candidate))
        .first();
      return taken !== null;
    });
    const albumId = await ctx.db.insert('albumAlbums', {
      prefix,
      slug,
      title: prefix,
      itemCount: 0,
      readyCount: 0,
      lastSeenScanAt: scannedAt,
    });
    return { albumId, slug, created: true };
  },
});

/** For each listed item, whether it needs its metadata read: `new` and `changed` ones do. */
export const diffItems = query({
  args: {
    secret: janktmSecret,
    albumId: v.id('albumAlbums'),
    items: v.array(scannedItem),
  },
  handler: async (ctx, { secret, albumId, items }) => {
    assertJanktmSecret(secret);
    return await Promise.all(
      items.map(async (item) => {
        const existing = await itemAt(ctx, albumId, item.path);
        const state: 'new' | 'changed' | 'unchanged' = !existing
          ? 'new'
          : isChanged(existing, item)
            ? 'changed'
            : 'unchanged';
        return { path: item.path, state };
      }),
    );
  },
});

/**
 * Saves a batch of the album's listed items:
 * - `changed`: new or changed items, with their metadata. New ones are inserted as `pending`;
 *   changed ones keep showing their old derivatives until the new ones are done.
 * - `unchanged`: paths of the rest, which are just marked as seen.
 *
 * Returns the jobs to queue: one per new or changed item, plus any still queued from before (in
 * case the service stopped before queueing them; queueing one again is a no-op).
 */
export const upsertItems = mutation({
  args: {
    secret: janktmSecret,
    albumId: v.id('albumAlbums'),
    scannedAt: v.number(),
    changed: v.array(scannedItemWithMetadata),
    unchanged: v.array(v.string()),
  },
  handler: async (ctx, { secret, albumId, scannedAt, changed, unchanged }) => {
    assertJanktmSecret(secret);
    if (!(await ctx.db.get('albumAlbums', albumId))) {
      throw new ConvexError({ code: 'not_found' as const });
    }

    const toQueue: JobInput[] = [];
    let added = 0;
    for (const item of changed) {
      const existing = await itemAt(ctx, albumId, item.path);
      const job = newJob(derivativesFor(item.kind, item.motion !== undefined));
      const fields = {
        kind: item.kind,
        original: item.original,
        motion: item.motion,
        media: item.media,
        takenAt: item.takenAt,
        takenAtSource: item.takenAtSource,
        job,
        lastSeenScanAt: scannedAt,
      };
      let itemId: Id<'albumItems'>;
      if (existing) {
        itemId = existing._id;
        await ctx.db.patch('albumItems', itemId, fields);
      } else {
        itemId = await ctx.db.insert('albumItems', {
          ...fields,
          albumId,
          path: item.path,
          status: 'pending',
          derivatives: {},
        });
        added++;
      }
      const saved = await ctx.db.get('albumItems', itemId);
      if (saved) toQueue.push(toJobInput(saved));
    }

    for (const path of unchanged) {
      const existing = await itemAt(ctx, albumId, path);
      // Gone since `diffItems`, or never there: the next scan will see it as new.
      if (!existing) continue;
      await ctx.db.patch('albumItems', existing._id, {
        lastSeenScanAt: scannedAt,
      });
      if (existing.job?.state === 'queued') toQueue.push(toJobInput(existing));
    }

    await updateAlbumStats(ctx, albumId, { items: added });
    return { toQueue, added };
  },
});

/**
 * Deletes a batch of the album's items that the scan didn't see. Call it until `done`, deleting
 * each returned item's derivatives (everything under `<itemId>/` in the derived bucket).
 */
export const sweepItems = mutation({
  args: {
    secret: janktmSecret,
    albumId: v.id('albumAlbums'),
    scannedAt: v.number(),
  },
  handler: async (ctx, { secret, albumId, scannedAt }) => {
    assertJanktmSecret(secret);
    const stale = await ctx.db
      .query('albumItems')
      .withIndex('by_album_lastSeenScanAt', (q) =>
        q.eq('albumId', albumId).lt('lastSeenScanAt', scannedAt),
      )
      .take(SWEEP_BATCH);
    let ready = 0;
    for (const item of stale) {
      if (item.status === 'ready') ready++;
      await ctx.db.delete('albumItems', item._id);
    }
    const album = await ctx.db.get('albumAlbums', albumId);
    if (album) {
      if (album.coverItemId && stale.some((i) => i._id === album.coverItemId)) {
        await ctx.db.patch('albumAlbums', albumId, { coverItemId: undefined });
      }
      await updateAlbumStats(ctx, albumId, {
        items: -stale.length,
        ready: -ready,
      });
    }
    return {
      deletedItemIds: stale.map((item) => item._id),
      done: stale.length < SWEEP_BATCH,
    };
  },
});

/** Albums a scan of every album didn't see, to sweep and delete. */
export const staleAlbums = query({
  args: { secret: janktmSecret, scannedAt: v.number() },
  handler: async (ctx, { secret, scannedAt }) => {
    assertJanktmSecret(secret);
    const albums = await ctx.db
      .query('albumAlbums')
      .withIndex('by_lastSeenScanAt', (q) => q.lt('lastSeenScanAt', scannedAt))
      .collect();
    return albums.map(({ _id, prefix }) => ({ albumId: _id, prefix }));
  },
});

/** Deletes an album the scan didn't see, once `sweepItems` has emptied it. */
export const deleteAlbum = mutation({
  args: {
    secret: janktmSecret,
    albumId: v.id('albumAlbums'),
    scannedAt: v.number(),
  },
  handler: async (ctx, { secret, albumId, scannedAt }) => {
    assertJanktmSecret(secret);
    const album = await ctx.db.get('albumAlbums', albumId);
    if (!album) return { deleted: false };
    if (album.lastSeenScanAt >= scannedAt) {
      throw new ConvexError({ code: 'seen' as const });
    }
    const item = await ctx.db
      .query('albumItems')
      .withIndex('by_album_path', (q) => q.eq('albumId', albumId))
      .first();
    if (item) throw new ConvexError({ code: 'not_empty' as const });
    await ctx.db.delete('albumAlbums', albumId);
    return { deleted: true };
  },
});

async function itemAt(
  ctx: QueryCtx,
  albumId: Id<'albumAlbums'>,
  path: string,
): Promise<Doc<'albumItems'> | null> {
  return await ctx.db
    .query('albumItems')
    .withIndex('by_album_path', (q) =>
      q.eq('albumId', albumId).eq('path', path),
    )
    .unique();
}

function isChanged(
  existing: Doc<'albumItems'>,
  item: { kind: string; original: S3Object; motion?: S3Object },
): boolean {
  return (
    existing.kind !== item.kind ||
    !sameObject(existing.original, item.original) ||
    !sameObject(existing.motion, item.motion)
  );
}

function sameObject(a: S3Object | undefined, b: S3Object | undefined) {
  if (!a || !b) return a === b;
  return (
    a.bucket === b.bucket &&
    a.key === b.key &&
    a.etag === b.etag &&
    a.sizeBytes === b.sizeBytes
  );
}
