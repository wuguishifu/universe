import { Injectable, Logger } from '@nestjs/common';
import {
  findYoutubeLink,
  type ImportResult,
  type Playlist,
} from '@projects/youtube-music-contracts';
import { YtdlpError, YtdlpService } from '../media/ytdlp.service';
import { DownloadsService } from './downloads.service';
import { LibraryError } from './library-error';
import { PlaylistsService } from './playlists.service';
import { toTrack, TracksService } from './tracks.service';

/** What a playlist's listing shows for videos that can't be downloaded. */
const UNAVAILABLE_TITLES = new Set(['[Private video]', '[Deleted video]']);

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly tracksService: TracksService,
    private readonly playlistsService: PlaylistsService,
    private readonly downloadsService: DownloadsService,
    private readonly ytdlpService: YtdlpService,
  ) {}

  /**
   * Adds a video to the library, or a playlist as a playlist (syncing it if it was imported
   * before), and queues whatever's new.
   */
  async import(input: string): Promise<ImportResult> {
    const link = findYoutubeLink(input);
    if (!link) {
      throw new LibraryError(
        "That isn't a link to a YouTube video or playlist",
      );
    }

    if (link.kind === 'video') {
      const [added] = await this.tracksService.addVideos([
        { youtubeId: link.videoId },
      ]);
      if (!added) throw new Error(`Adding ${link.videoId} returned no row`);
      let { row } = added;
      if (row.status === 'failed') {
        row = (await this.tracksService.requeue(row.id)) ?? row;
      }
      if (added.created || row.status === 'queued') {
        await this.downloadsService.enqueue(row.id);
      }
      this.logger.log(
        added.created
          ? `Queued ${link.videoId}`
          : `${link.videoId} is already in the library (${row.status})`,
      );
      return {
        kind: 'video',
        track: toTrack(row),
        alreadyInLibrary: !added.created,
      };
    }

    const existing = await this.playlistsService.findByYoutubeId(
      link.playlistId,
    );
    if (existing) {
      return { kind: 'playlist', ...(await this.sync(existing)) };
    }
    const listing = await this.list(link.playlistId);
    const playlist = await this.playlistsService.create(
      listing.title,
      link.playlistId,
    );
    return {
      kind: 'playlist',
      ...(await this.addEntries(playlist, listing.entries)),
    };
  }

  /** Adds the videos in a YouTube playlist that the imported one doesn't have. */
  async sync(playlist: Playlist) {
    if (!playlist.youtubePlaylistId) {
      throw new LibraryError("This playlist wasn't imported from YouTube");
    }
    const listing = await this.list(playlist.youtubePlaylistId);
    return this.addEntries(playlist, listing.entries);
  }

  private async list(playlistId: string) {
    try {
      return await this.ytdlpService.listPlaylist(playlistId);
    } catch (error) {
      if (error instanceof YtdlpError) {
        throw new LibraryError(`Couldn't read the playlist: ${error.message}`);
      }
      throw error;
    }
  }

  private async addEntries(
    playlist: Playlist,
    entries: { id: string; title: string | null }[],
  ): Promise<{ playlist: Playlist; queued: number }> {
    const added = await this.tracksService.addVideos(
      entries
        .filter((e) => !e.title || !UNAVAILABLE_TITLES.has(e.title))
        .map((e) => ({ youtubeId: e.id, title: e.title })),
    );
    const created = added.filter((a) => a.created);
    for (const { row } of created) await this.downloadsService.enqueue(row.id);

    const updated = await this.playlistsService.addTracks(
      playlist.id,
      added.map((a) => a.row.id),
    );
    this.logger.log(
      `Playlist "${playlist.name}": ${entries.length} on YouTube, queued ${created.length}`,
    );
    return { playlist: updated ?? playlist, queued: created.length };
  }
}
