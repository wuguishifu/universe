import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  derivatives,
  itemJob,
  itemKind,
  itemStatus,
  mediaInfo,
  s3Location,
  s3Object,
  takenAtSource,
} from './validators';

/**
 * The janktm photo album. The originals bucket is the source of truth (janktm-service scans it
 * and writes here); this is its index plus what's been generated for each file. Reads are public.
 */
export const albumTables = {
  /** A top-level folder of the originals bucket. */
  albumAlbums: defineTable({
    /** The folder's exact name, e.g. "2022-06-12 GRADUATION!". */
    prefix: v.string(),
    /** For URLs, e.g. "2022-06-12-graduation". Set once, so links survive title edits. */
    slug: v.string(),
    /** Starts as the folder's name; edit it freely. */
    title: v.string(),
    /** Unset means the first ready item. */
    coverItemId: v.optional(v.id('albumItems')),
    itemCount: v.number(),
    readyCount: v.number(),
    /** The first and last ready items' `takenAt`. */
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    /** When the last scan that saw the folder started; a full scan deletes albums it didn't see. */
    lastSeenScanAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_prefix', ['prefix'])
    .index('by_lastSeenScanAt', ['lastSeenScanAt']),

  /** A photo or video (a Live Photo is one photo item with `motion`). */
  albumItems: defineTable({
    albumId: v.id('albumAlbums'),
    /** The key after the album's folder, e.g. "Bo's Uploads/IMG_5974.HEIC". */
    path: v.string(),
    kind: itemKind,
    original: s3Object,
    motion: v.optional(s3Object),
    media: mediaInfo,
    /** When it was taken (ms since the epoch); see `takenAtSource` for how sure that is. */
    takenAt: v.number(),
    takenAtSource,
    /** As displayed (after rotation), from the display derivative once there is one. */
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    status: itemStatus,
    derivatives,
    job: v.optional(itemJob),
    /**
     * Derivatives that completed jobs replaced, for janktm-service to delete (then `clearGarbage`).
     * Kept here, in the transaction that replaced them, so a failed delete is retried.
     */
    garbage: v.optional(v.array(s3Location)),
    /** When the last scan that saw it started; each scan deletes its album's items it didn't see. */
    lastSeenScanAt: v.number(),
  })
    .index('by_album_status_takenAt', ['albumId', 'status', 'takenAt'])
    .index('by_album_path', ['albumId', 'path'])
    .index('by_album_lastSeenScanAt', ['albumId', 'lastSeenScanAt']),
};
