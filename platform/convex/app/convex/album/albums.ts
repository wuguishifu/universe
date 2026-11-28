import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';

import { edgeReadyItem } from './helpers';
import { publicAlbum, signerFor } from './media';

/**
 * Public reads. Every query that returns media takes `signingWindow`: pass
 * `Math.floor(Date.now() / SIGNING_WINDOW_MS)` (see ./signing.ts).
 */

/** Albums with anything to show, newest first. */
export const list = query({
  args: { signingWindow: v.number() },
  handler: async (ctx, { signingWindow }) => {
    const sign = signerFor(signingWindow);
    const albums = (await ctx.db.query('albumAlbums').collect())
      .filter((album) => album.readyCount > 0)
      .sort(
        (a, b) =>
          (b.startAt ?? 0) - (a.startAt ?? 0) ||
          b.prefix.localeCompare(a.prefix),
      );
    return await Promise.all(
      albums.map(async (album) =>
        publicAlbum(sign, album, await coverOf(ctx, album)),
      ),
    );
  },
});

export const get = query({
  args: { slug: v.string(), signingWindow: v.number() },
  handler: async (ctx, { slug, signingWindow }) => {
    const sign = signerFor(signingWindow);
    const album = await ctx.db
      .query('albumAlbums')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique();
    if (!album || album.readyCount === 0) return null;
    return await publicAlbum(sign, album, await coverOf(ctx, album));
  },
});

/** The album's chosen cover while it's ready, else its first ready item. */
async function coverOf(
  ctx: QueryCtx,
  album: Doc<'albumAlbums'>,
): Promise<Doc<'albumItems'> | null> {
  if (album.coverItemId) {
    const cover = await ctx.db.get('albumItems', album.coverItemId);
    if (cover?.status === 'ready') return cover;
  }
  return await edgeReadyItem(ctx, album._id, 'asc');
}
