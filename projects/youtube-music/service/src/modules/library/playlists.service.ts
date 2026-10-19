import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { musicPlaylists, musicPlaylistTracks } from '@platform/postgres-db';
import type { Playlist } from '@projects/youtube-music-contracts';
import { LibraryError } from './library-error';
import { TracksService } from './tracks.service';

type PlaylistRow = typeof musicPlaylists.$inferSelect;

const toPlaylist = (row: PlaylistRow, trackIds: number[]): Playlist => ({
  id: row.id,
  name: row.name,
  youtubePlaylistId: row.youtubePlaylistId,
  trackIds,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class PlaylistsService {
  constructor(
    @Inject(UNIVERSE_DB) private readonly db: UniverseDb,
    private readonly tracksService: TracksService,
  ) {}

  /** By name, each with its track IDs in order. */
  public async list(): Promise<Playlist[]> {
    const [rows, entries] = await Promise.all([
      this.db
        .select()
        .from(musicPlaylists)
        .orderBy(asc(musicPlaylists.name), asc(musicPlaylists.id)),
      this.db
        .select({
          playlistId: musicPlaylistTracks.playlistId,
          trackId: musicPlaylistTracks.trackId,
        })
        .from(musicPlaylistTracks)
        .orderBy(asc(musicPlaylistTracks.position)),
    ]);
    const trackIds = new Map<number, number[]>();
    for (const { playlistId, trackId } of entries) {
      const ids = trackIds.get(playlistId) ?? [];
      ids.push(trackId);
      trackIds.set(playlistId, ids);
    }
    return rows.map((row) => toPlaylist(row, trackIds.get(row.id) ?? []));
  }

  public async get(id: number): Promise<Playlist | null> {
    const [row] = await this.db
      .select()
      .from(musicPlaylists)
      .where(eq(musicPlaylists.id, id));
    return row ? toPlaylist(row, await this.trackIds(id)) : null;
  }

  public async findByYoutubeId(
    youtubePlaylistId: string,
  ): Promise<Playlist | null> {
    const [row] = await this.db
      .select()
      .from(musicPlaylists)
      .where(eq(musicPlaylists.youtubePlaylistId, youtubePlaylistId));
    return row ? toPlaylist(row, await this.trackIds(row.id)) : null;
  }

  public async create(
    name: string,
    youtubePlaylistId: string | null = null,
  ): Promise<Playlist> {
    const [row] = await this.db
      .insert(musicPlaylists)
      .values({ name, youtubePlaylistId })
      .returning();
    if (!row) throw new Error('Creating a playlist returned no row');
    return toPlaylist(row, []);
  }

  public async rename(id: number, name: string): Promise<Playlist | null> {
    const [row] = await this.db
      .update(musicPlaylists)
      .set({ name })
      .where(eq(musicPlaylists.id, id))
      .returning();
    return row ? toPlaylist(row, await this.trackIds(id)) : null;
  }

  public async remove(id: number): Promise<boolean> {
    const rows = await this.db
      .delete(musicPlaylists)
      .where(eq(musicPlaylists.id, id))
      .returning({ id: musicPlaylists.id });
    return rows.length > 0;
  }

  /** Replaces the playlist's tracks with these, in this order. Duplicates after the first go. */
  public async setTracks(
    id: number,
    trackIds: number[],
  ): Promise<Playlist | null> {
    const ids = [...new Set(trackIds)];
    await this.assertTracksExist(ids);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(musicPlaylists)
        .set({ updatedAt: new Date() })
        .where(eq(musicPlaylists.id, id))
        .returning();
      if (!row) return null;
      await tx
        .delete(musicPlaylistTracks)
        .where(eq(musicPlaylistTracks.playlistId, id));
      if (ids.length) {
        await tx.insert(musicPlaylistTracks).values(
          ids.map((trackId, position) => ({
            playlistId: id,
            trackId,
            position,
          })),
        );
      }
      return toPlaylist(row, ids);
    });
  }

  /** Adds these to the end of the playlist, skipping any already in it. */
  public async addTracks(
    id: number,
    trackIds: number[],
  ): Promise<Playlist | null> {
    const ids = [...new Set(trackIds)];
    if (ids.length === 0) return this.get(id);
    await this.assertTracksExist(ids);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(musicPlaylists)
        .set({ updatedAt: new Date() })
        .where(eq(musicPlaylists.id, id))
        .returning();
      if (!row) return null;
      const present = await tx
        .select({ trackId: musicPlaylistTracks.trackId })
        .from(musicPlaylistTracks)
        .where(
          and(
            eq(musicPlaylistTracks.playlistId, id),
            inArray(musicPlaylistTracks.trackId, ids),
          ),
        );
      const presentIds = new Set(present.map((p) => p.trackId));
      const added = ids.filter((trackId) => !presentIds.has(trackId));
      if (added.length) {
        const [last] = await tx
          .select({ position: max(musicPlaylistTracks.position) })
          .from(musicPlaylistTracks)
          .where(eq(musicPlaylistTracks.playlistId, id));
        const start = (last?.position ?? -1) + 1;
        await tx.insert(musicPlaylistTracks).values(
          added.map((trackId, index) => ({
            playlistId: id,
            trackId,
            position: start + index,
          })),
        );
      }
      const ordered = await tx
        .select({ trackId: musicPlaylistTracks.trackId })
        .from(musicPlaylistTracks)
        .where(eq(musicPlaylistTracks.playlistId, id))
        .orderBy(asc(musicPlaylistTracks.position));
      return toPlaylist(
        row,
        ordered.map((o) => o.trackId),
      );
    });
  }

  private async trackIds(playlistId: number): Promise<number[]> {
    const rows = await this.db
      .select({ trackId: musicPlaylistTracks.trackId })
      .from(musicPlaylistTracks)
      .where(eq(musicPlaylistTracks.playlistId, playlistId))
      .orderBy(asc(musicPlaylistTracks.position));
    return rows.map((row) => row.trackId);
  }

  private async assertTracksExist(ids: number[]) {
    const existing = await this.tracksService.existingIds(ids);
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length) {
      throw new LibraryError(`No tracks ${missing.join(', ')}`);
    }
  }
}
