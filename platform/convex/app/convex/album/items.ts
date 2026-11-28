import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { albumQuery } from './auth';
import { signDerivative, signerFor } from './media';
import type { Signer } from './signing';
import { basename } from './slugs';

/**
 * A page of an album's ready items, oldest first, with what a grid needs: the thumbnail, and the
 * hover loop for anything that moves. `getItem` has the rest.
 */
export const list = albumQuery({
  args: {
    albumId: v.id('albumAlbums'),
    paginationOpts: paginationOptsValidator,
    signingWindow: v.number(),
  },
  handler: async (ctx, { albumId, paginationOpts, signingWindow }) => {
    const sign = signerFor(signingWindow);
    const page = await ctx.db
      .query('albumItems')
      .withIndex('by_album_status_takenAt', (q) =>
        q.eq('albumId', albumId).eq('status', 'ready'),
      )
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (item) => ({
          ...summary(item),
          thumb: await signDerivative(sign, item.derivatives.thumb),
          hover: await signDerivative(sign, item.derivatives.hover),
        })),
      ),
    };
  },
});

/** One ready item, with its lightbox image, video, and a download of the original. */
export const get = albumQuery({
  args: { itemId: v.string(), signingWindow: v.number() },
  handler: async (ctx, { itemId: rawId, signingWindow }) => {
    const sign = signerFor(signingWindow);
    const itemId = ctx.db.normalizeId('albumItems', rawId);
    const item = itemId && (await ctx.db.get('albumItems', itemId));
    if (!item || item.status !== 'ready') return null;
    const { derivatives: d } = item;
    return {
      ...summary(item),
      thumb: await signDerivative(sign, d.thumb),
      display: await signDerivative(sign, d.display),
      hover: await signDerivative(sign, d.hover),
      preview: await signDerivative(sign, d.preview),
      original: await signOriginal(sign, item),
    };
  },
});

function summary(item: Doc<'albumItems'>) {
  return {
    id: item._id,
    albumId: item.albumId,
    kind: item.kind,
    isLivePhoto: item.motion !== undefined,
    name: basename(item.path),
    path: item.path,
    takenAt: item.takenAt,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.media.durationMs ?? null,
  };
}

async function signOriginal(sign: Signer, item: Doc<'albumItems'>) {
  return {
    url: await sign(item.original, { downloadName: basename(item.path) }),
    sizeBytes: item.original.sizeBytes,
  };
}
