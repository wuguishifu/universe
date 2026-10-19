import {
  boolean,
  index,
  integer,
  pgSchema,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const musicPgSchema = pgSchema('music');

/** youtube-music's library: one row per YouTube video, whatever state its download is in. */
export const musicTracks = musicPgSchema.table('tracks', {
  id: serial('id').primaryKey(),
  youtubeId: text('youtube_id').notNull().unique(),
  /** Null until it's known, from a playlist's listing or the video's info. */
  title: text('title'),
  artist: text('artist'),
  album: text('album'),
  durationSec: real('duration_sec'),
  /** Set once the title, artist or album is edited, so the video's info doesn't overwrite them. */
  metadataEdited: boolean('metadata_edited').notNull().default(false),
  status: text('status', {
    enum: ['queued', 'downloading', 'ready', 'failed'],
  })
    .notNull()
    .default('queued'),
  /** The last attempt's error. Kept while it's retried, cleared once it's ready. */
  error: text('error'),
  /** S3 keys, in MUSIC_S3_BUCKET. Set once it's ready. */
  audioKey: text('audio_key'),
  audioMimeType: text('audio_mime_type'),
  audioSizeBytes: integer('audio_size_bytes'),
  artworkKey: text('artwork_key'),
  /** EBU R128 integrated loudness, for the app to even out volume between tracks. */
  loudnessLufs: real('loudness_lufs'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const musicPlaylists = musicPgSchema.table('playlists', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Set when it was imported from a YouTube playlist, so it can be synced with it. */
  youtubePlaylistId: text('youtube_playlist_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** A track is in a playlist at most once. Positions are 0-based and rewritten on every reorder. */
export const musicPlaylistTracks = musicPgSchema.table(
  'playlist_tracks',
  {
    playlistId: integer('playlist_id')
      .notNull()
      .references(() => musicPlaylists.id, { onDelete: 'cascade' }),
    trackId: integer('track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.playlistId, table.trackId] }),
    index('playlist_tracks_playlist_id_position_idx').on(
      table.playlistId,
      table.position,
    ),
  ],
);

export const musicSchema = {
  tracks: musicTracks,
  playlists: musicPlaylists,
  playlistTracks: musicPlaylistTracks,
};
