import { z } from 'zod';

export const trackStatusSchema = z.enum([
  'queued',
  'downloading',
  'ready',
  'failed',
]);
export type TrackStatus = z.infer<typeof trackStatusSchema>;

export const trackSchema = z.object({
  id: z.number(),
  youtubeId: z.string(),
  /** Null until the download has read the video's info. */
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  durationSec: z.number().nullable(),
  status: trackStatusSchema,
  /** Why the last attempt failed. Set while it's retried too. */
  error: z.string().nullable(),
  audioSizeBytes: z.number().nullable(),
  hasArtwork: z.boolean(),
  /** EBU R128 integrated loudness of the audio. */
  loudnessLufs: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Track = z.infer<typeof trackSchema>;

const optionalText = z.string().trim().max(300).nullable();

export const trackUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    artist: optionalText,
    album: optionalText,
  })
  .partial();
export type TrackUpdate = z.infer<typeof trackUpdateSchema>;

export const playlistSchema = z.object({
  id: z.number(),
  name: z.string(),
  /** Set when it was imported from YouTube, which makes it syncable. */
  youtubePlaylistId: z.string().nullable(),
  /** In playlist order. */
  trackIds: z.number().array(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Playlist = z.infer<typeof playlistSchema>;

export const playlistNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const trackIdsSchema = z.object({
  trackIds: z.number().int().array().max(5000),
});

export const importInputSchema = z.object({
  /** A video or playlist link, or text with one in it. */
  url: z.string().min(1).max(2000),
});

export const importResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    track: trackSchema,
    /** It was already there, so nothing new was queued (unless it had failed). */
    alreadyInLibrary: z.boolean(),
  }),
  z.object({
    kind: z.literal('playlist'),
    playlist: playlistSchema,
    /** Videos new to the library, now downloading. */
    queued: z.number(),
  }),
]);
export type ImportResult = z.infer<typeof importResultSchema>;

export const serverStatusSchema = z.object({
  ytdlpVersion: z.string().nullable(),
  queue: z.object({
    waiting: z.number(),
    active: z.number(),
    failed: z.number(),
  }),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const errorSchema = z.object({ message: z.string() });
