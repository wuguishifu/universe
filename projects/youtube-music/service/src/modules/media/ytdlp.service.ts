import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProcessError } from '@libs/nest-common';
import {
  youtubePlaylistUrl,
  youtubeVideoUrl,
} from '@projects/youtube-music-contracts';
import { EnvironmentService } from '../../environment/environment';
import {
  playlistInfoSchema,
  type VideoInfo,
  videoInfoSchema,
} from './metadata';
import { runCommand } from './run-command';

const INFO_TIMEOUT_MS = 60_000;
const PLAYLIST_TIMEOUT_MS = 3 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const VERSION_TTL_MS = 5 * 60_000;

/** Prefer an m4a (AAC) stream, which iOS plays natively; anything else is converted to one. */
const AUDIO_FORMAT = 'bestaudio[ext=m4a]/bestaudio/best';

/** yt-dlp errors that trying again won't fix. */
const PERMANENT_ERROR =
  /Video (is )?unavailable|Private video|This video has been removed|members-only|Join this channel|Sign in to confirm your age|account associated with this video has been terminated|is not available in your country|Unsupported URL|Incomplete YouTube ID|This live event will begin/i;

export class YtdlpError extends Error {
  constructor(
    message: string,
    /** Whether trying again could work. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type PlaylistListing = {
  title: string;
  entries: { id: string; title: string | null }[];
};

export type DownloadedFiles = {
  audioPath: string;
  /** The video's thumbnail as a JPEG, if it had one. */
  thumbnailPath: string | null;
};

@Injectable()
export class YtdlpService implements OnModuleInit {
  private readonly logger = new Logger(YtdlpService.name);
  private readonly path: string;
  private readonly baseArgs: string[];
  private cachedVersion: { value: Promise<string | null>; at: number } | null =
    null;

  constructor(environmentService: EnvironmentService) {
    const { ytdlpPath, ytdlpExtraArgs, ffmpegPath } =
      environmentService.environment;
    this.path = ytdlpPath;
    const extraArgs = ytdlpExtraArgs.split(/\s+/).filter(Boolean);
    this.baseArgs = [
      // YouTube needs a JavaScript runtime to extract formats; use the Node running this app.
      ...(extraArgs.includes('--js-runtimes')
        ? []
        : ['--js-runtimes', `node:${process.execPath}`]),
      // A bare command name is looked up on PATH by yt-dlp itself.
      ...(ffmpegPath.includes('/') ? ['--ffmpeg-location', ffmpegPath] : []),
      '--no-warnings',
      ...extraArgs,
    ];
  }

  /** yt-dlp is mounted from the host rather than part of the image, so check it's there. */
  async onModuleInit() {
    const version = await this.version();
    if (!version) {
      throw new Error(
        `Can't run yt-dlp at YTDLP_PATH=${this.path} (is it mounted?)`,
      );
    }
    this.logger.log(`Using yt-dlp ${version} at ${this.path}`);
  }

  /** Cached, so status checks don't spawn yt-dlp; rechecked now and then in case it's updated. */
  version(): Promise<string | null> {
    if (
      !this.cachedVersion ||
      Date.now() - this.cachedVersion.at >= VERSION_TTL_MS
    ) {
      this.cachedVersion = {
        value: runCommand(this.path, ['--version'], { timeoutMs: 15_000 })
          .then(({ stdout }) => stdout.trim() || null)
          .catch(() => null),
        at: Date.now(),
      };
    }
    return this.cachedVersion.value;
  }

  /**
   * A video's info, also written to `infoPath` so `download` can reuse it instead of extracting it
   * again.
   */
  async fetchInfo(
    videoId: string,
    infoPath: string,
    signal?: AbortSignal,
  ): Promise<VideoInfo> {
    const { stdout } = await this.run(
      ['--no-playlist', '-J', youtubeVideoUrl(videoId)],
      INFO_TIMEOUT_MS,
      signal,
    );
    await writeFile(infoPath, stdout);
    return videoInfoSchema.parse(JSON.parse(stdout));
  }

  async listPlaylist(playlistId: string): Promise<PlaylistListing> {
    const { stdout } = await this.run(
      ['--flat-playlist', '-J', youtubePlaylistUrl(playlistId)],
      PLAYLIST_TIMEOUT_MS,
    );
    const json = playlistInfoSchema.parse(JSON.parse(stdout));
    return {
      title: json.title ?? playlistId,
      entries: (json.entries ?? []).flatMap((e) =>
        e.id ? [{ id: e.id, title: e.title ?? null }] : [],
      ),
    };
  }

  /** Downloads the audio and thumbnail of the video in `infoPath` (from `fetchInfo`) into `dir`. */
  async download(
    infoPath: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<DownloadedFiles> {
    await this.run(
      [
        '--load-info-json',
        infoPath,
        '--no-progress',
        '--no-mtime',
        '-f',
        AUDIO_FORMAT,
        '--extract-audio',
        '--audio-format',
        'm4a',
        // Only used when the best stream isn't AAC already and has to be converted.
        '--audio-quality',
        '192K',
        '--write-thumbnail',
        '--convert-thumbnails',
        'jpg',
        '-P',
        dir,
        '-o',
        'audio.%(ext)s',
        '-o',
        'thumbnail:artwork.%(ext)s',
      ],
      DOWNLOAD_TIMEOUT_MS,
      signal,
    );

    const files = await readdir(dir);
    const audio = files.find((f) => f === 'audio.m4a');
    if (!audio) {
      throw new YtdlpError(
        `yt-dlp finished without an audio file (got ${files.join(', ')})`,
        true,
      );
    }
    const thumbnail = files.find((f) => f === 'artwork.jpg');
    return {
      audioPath: join(dir, audio),
      thumbnailPath: thumbnail ? join(dir, thumbnail) : null,
    };
  }

  private async run(args: string[], timeoutMs: number, signal?: AbortSignal) {
    const fullArgs = [...this.baseArgs, ...args];
    this.logger.debug(`${this.path} ${fullArgs.join(' ')}`);
    try {
      return await runCommand(this.path, fullArgs, { timeoutMs, signal });
    } catch (error) {
      if (error instanceof ProcessError) {
        const message = readableError(error.stderrTail) || error.message;
        throw new YtdlpError(message, !PERMANENT_ERROR.test(message));
      }
      throw error;
    }
  }
}

/** "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable" ─► "Video unavailable", for showing in the app. */
export const readableError = (stderr: string) =>
  stderr
    .replace(/^ERROR:\s*/gm, '')
    .replace(/^\[[\w:]+\]\s*[\w-]+:\s*/gm, '')
    .trim();
