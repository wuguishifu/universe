import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { musicTracks } from '@platform/postgres-db';
import type { Track, TrackUpdate } from '@projects/youtube-music-contracts';
import { type TrackMetadata } from '../media/metadata';

export type TrackRow = typeof musicTracks.$inferSelect;

export const toTrack = (row: TrackRow): Track => ({
  id: row.id,
  youtubeId: row.youtubeId,
  title: row.title,
  artist: row.artist,
  album: row.album,
  durationSec: row.durationSec,
  status: row.status,
  error: row.error,
  audioSizeBytes: row.audioSizeBytes,
  hasArtwork: row.artworkKey !== null,
  loudnessLufs: row.loudnessLufs,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export type ReadyFields = {
  audioKey: string;
  audioMimeType: string;
  audioSizeBytes: number;
  artworkKey: string | null;
  loudnessLufs: number | null;
};

@Injectable()
export class TracksService {
  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  public async list(): Promise<Track[]> {
    const rows = await this.db
      .select()
      .from(musicTracks)
      .orderBy(desc(musicTracks.createdAt), desc(musicTracks.id));
    return rows.map(toTrack);
  }

  public async find(id: number): Promise<TrackRow | null> {
    const [row] = await this.db
      .select()
      .from(musicTracks)
      .where(eq(musicTracks.id, id));
    return row ?? null;
  }

  /** IDs of these that exist. */
  public async existingIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: musicTracks.id })
      .from(musicTracks)
      .where(inArray(musicTracks.id, ids));
    return new Set(rows.map((row) => row.id));
  }

  /** Tracks that should have a download job, to queue them again on startup. */
  public unfinished(): Promise<TrackRow[]> {
    return this.db
      .select()
      .from(musicTracks)
      .where(inArray(musicTracks.status, ['queued', 'downloading']));
  }

  /**
   * Adds these videos to the library, or finds them if they're there. Rows come back in the same
   * order, with `created` saying which are new.
   */
  public async addVideos(
    videos: { youtubeId: string; title?: string | null }[],
  ): Promise<{ row: TrackRow; created: boolean }[]> {
    if (videos.length === 0) return [];
    const created = await this.db
      .insert(musicTracks)
      .values(
        videos.map(({ youtubeId, title }) => ({
          youtubeId,
          title: title ?? null,
        })),
      )
      .onConflictDoNothing({ target: musicTracks.youtubeId })
      .returning();
    const createdIds = new Set(created.map((row) => row.id));
    const rows = await this.db
      .select()
      .from(musicTracks)
      .where(
        inArray(
          musicTracks.youtubeId,
          videos.map((v) => v.youtubeId),
        ),
      );
    const byYoutubeId = new Map(rows.map((row) => [row.youtubeId, row]));
    return videos.flatMap(({ youtubeId }) => {
      const row = byYoutubeId.get(youtubeId);
      return row ? [{ row, created: createdIds.has(row.id) }] : [];
    });
  }

  public async update(id: number, input: TrackUpdate): Promise<Track | null> {
    if (Object.keys(input).length === 0) {
      const row = await this.find(id);
      return row && toTrack(row);
    }
    const [row] = await this.db
      .update(musicTracks)
      .set({ ...input, metadataEdited: true })
      .where(eq(musicTracks.id, id))
      .returning();
    return row ? toTrack(row) : null;
  }

  public async remove(id: number): Promise<TrackRow | null> {
    const [row] = await this.db
      .delete(musicTracks)
      .where(eq(musicTracks.id, id))
      .returning();
    return row ?? null;
  }

  /** Back to queued, for a failed track that's being retried. */
  public async requeue(id: number): Promise<TrackRow | null> {
    const [row] = await this.db
      .update(musicTracks)
      .set({ status: 'queued', error: null })
      .where(eq(musicTracks.id, id))
      .returning();
    return row ?? null;
  }

  public async markDownloading(id: number) {
    await this.db
      .update(musicTracks)
      .set({ status: 'downloading' })
      .where(eq(musicTracks.id, id));
  }

  /**
   * Fills in what the video's info says, early, so the app shows the title while the audio
   * downloads. Leaves the title, artist and album alone if they were edited in the app.
   */
  public async setMetadata(id: number, metadata: TrackMetadata) {
    const { durationSec, ...text } = metadata;
    await this.db
      .update(musicTracks)
      .set({ durationSec })
      .where(eq(musicTracks.id, id));
    await this.db
      .update(musicTracks)
      .set(text)
      .where(
        and(eq(musicTracks.id, id), eq(musicTracks.metadataEdited, false)),
      );
  }

  /** Null if the track was deleted while it downloaded. */
  public async markReady(
    id: number,
    fields: ReadyFields,
  ): Promise<TrackRow | null> {
    const [row] = await this.db
      .update(musicTracks)
      .set({ ...fields, status: 'ready', error: null })
      .where(eq(musicTracks.id, id))
      .returning();
    return row ?? null;
  }

  public async markFailed(id: number, error: string, willRetry: boolean) {
    await this.db
      .update(musicTracks)
      .set({ status: willRetry ? 'queued' : 'failed', error })
      .where(eq(musicTracks.id, id));
  }
}
