import { type Infer, v } from 'convex/values';

export const itemKind = v.union(v.literal('photo'), v.literal('video'));
export type ItemKind = Infer<typeof itemKind>;

/**
 * - `pending`: never processed yet, so there's no thumbnail and the item isn't listed.
 * - `ready`: has its thumbnail, so it's listed. Stays `ready` while it's reprocessed.
 * - `failed`: its first processing failed (see `job.error`), so it isn't listed.
 */
export const itemStatus = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('failed'),
);
export type ItemStatus = Infer<typeof itemStatus>;

export const DERIVATIVE_KINDS = [
  'thumb',
  'display',
  'hover',
  'preview',
] as const;
/**
 * - `thumb`: for the grid, fit within 512px. A video's is its poster frame.
 * - `display`: for the lightbox, fit within 2048px. A video's is its poster frame.
 * - `hover`: a short muted loop for videos and Live Photos.
 * - `preview`: a web-playable 1080p H.264 copy of a video.
 */
export const derivativeKind = v.union(
  v.literal('thumb'),
  v.literal('display'),
  v.literal('hover'),
  v.literal('preview'),
);
export type DerivativeKind = Infer<typeof derivativeKind>;

/** An S3 object as the scan listed it. */
export const s3Object = v.object({
  bucket: v.string(),
  key: v.string(),
  etag: v.string(),
  sizeBytes: v.number(),
});
export type S3Object = Infer<typeof s3Object>;

/** What the scan read from the original's metadata. Everything's optional: files lie. */
export const mediaInfo = v.object({
  /** As stored, before `orientation` or `rotationDeg`. */
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  /** EXIF orientation, 1-8. */
  orientation: v.optional(v.number()),
  /** A video's display rotation, in degrees clockwise. */
  rotationDeg: v.optional(v.number()),
  /** A video with an HDR transfer function (HLG or PQ), which needs tone mapping. */
  hdr: v.optional(v.boolean()),
});
export type MediaInfo = Infer<typeof mediaInfo>;

/** Which of janktm-service's capture time sources won, best first. */
export const takenAtSource = v.union(
  /** EXIF DateTimeOriginal with OffsetTimeOriginal, or Apple's QuickTime creationdate. */
  v.literal('metadata'),
  /** EXIF DateTimeOriginal without an offset, read in the service's default time zone. */
  v.literal('metadataLocal'),
  /** A video's mvhd creation time (UTC). */
  v.literal('mvhd'),
  v.literal('filename'),
  /** The date the album's folder name starts with. */
  v.literal('folder'),
  /** The object's S3 LastModified, which is really when it was uploaded. */
  v.literal('lastModified'),
);
export type TakenAtSource = Infer<typeof takenAtSource>;

/** A generated file in the derived bucket. */
export const derivative = v.object({
  bucket: v.string(),
  key: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
});
export type Derivative = Infer<typeof derivative>;

export const derivatives = v.object({
  thumb: v.optional(derivative),
  display: v.optional(derivative),
  hover: v.optional(derivative),
  preview: v.optional(derivative),
});
export type Derivatives = Infer<typeof derivatives>;

/**
 * The item's latest processing job. A job's results only apply while its `token` is the item's:
 * queueing a new job (a changed file, a reprocess) makes the old one's results stale.
 */
export const itemJob = v.object({
  /** Also the job's idempotency key in BullMQ, so it's a UUID (no ':'). */
  token: v.string(),
  state: v.union(v.literal('queued'), v.literal('failed')),
  derivatives: v.array(derivativeKind),
  queuedAt: v.number(),
  error: v.optional(v.string()),
});
export type ItemJob = Infer<typeof itemJob>;

/** One listed item as the scan sends it. */
export const scannedItem = v.object({
  /** The key after the album's folder, e.g. "Bo's Uploads/IMG_5974.HEIC". */
  path: v.string(),
  kind: itemKind,
  original: s3Object,
  /** A Live Photo's video. */
  motion: v.optional(s3Object),
});
export type ScannedItem = Infer<typeof scannedItem>;

/** A new or changed item, with the metadata the scan read for it. */
export const scannedItemWithMetadata = v.object({
  ...scannedItem.fields,
  media: mediaInfo,
  takenAt: v.number(),
  takenAtSource,
});
export type ScannedItemWithMetadata = Infer<typeof scannedItemWithMetadata>;
