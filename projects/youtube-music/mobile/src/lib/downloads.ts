import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import type { Track } from '@projects/youtube-music-contracts';
import { artworkUrl, audioUrl, authHeaders, type Connection } from './api';

export type DownloadState =
  | { status: 'queued' }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; bytes: number }
  | { status: 'failed'; error: string };

type Job = { track: Track; connection: Connection };

const CONCURRENCY = 2;
const AUDIO_EXT = '.m4a';
const PARTIAL_EXT = '.part';

/**
 * Tracks kept on the phone, in Documents/tracks as <id>.m4a (and <id>.jpg for the artwork), so they
 * play offline. The files are the source of truth: what's there on startup is what's downloaded.
 */
class Downloads {
  private readonly dir = new Directory(Paths.document, 'tracks');
  private states = new Map<number, DownloadState>();
  private readonly listeners = new Set<() => void>();
  private readonly queue: Job[] = [];
  /** Downloads in flight, to cancel them. */
  private readonly running = new Map<number, AbortController>();
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.initialized = true;
    this.dir.create({ idempotent: true, intermediates: true });
    for (const entry of this.dir.list()) {
      if (!(entry instanceof File)) continue;
      if (entry.name.endsWith(PARTIAL_EXT)) {
        // Left over from a download that was cut off.
        entry.delete();
        continue;
      }
      const match = /^(\d+)\.m4a$/.exec(entry.name);
      if (match) {
        this.states.set(Number(match[1]), {
          status: 'downloaded',
          bytes: entry.size,
        });
      }
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A new map on every change, so React sees it change. */
  getSnapshot = (): ReadonlyMap<number, DownloadState> => {
    this.init();
    return this.states;
  };

  private set(id: number, state: DownloadState | null) {
    const next = new Map(this.states);
    if (state) next.set(id, state);
    else next.delete(id);
    this.states = next;
    for (const listener of this.listeners) listener();
  }

  isDownloaded(id: number) {
    this.init();
    return this.states.get(id)?.status === 'downloaded';
  }

  private audioFile = (id: number) => new File(this.dir, `${id}${AUDIO_EXT}`);
  private artworkFile = (id: number) => new File(this.dir, `${id}.jpg`);

  /** file:// URI of the downloaded audio, or null. */
  localAudioUri(id: number): string | null {
    return this.isDownloaded(id) ? this.audioFile(id).uri : null;
  }

  /** file:// URI of the downloaded artwork, or null. */
  localArtworkUri(id: number): string | null {
    if (!this.isDownloaded(id)) return null;
    const file = this.artworkFile(id);
    return file.exists ? file.uri : null;
  }

  /** Queues tracks that are ready on the server and aren't on the phone or on their way. */
  download(tracks: Track[], connection: Connection) {
    this.init();
    for (const track of tracks) {
      const state = this.states.get(track.id);
      if (track.status !== 'ready') continue;
      if (state && state.status !== 'failed') continue;
      this.queue.push({ track, connection });
      this.set(track.id, { status: 'queued' });
    }
    this.pump();
  }

  remove(id: number) {
    this.init();
    const index = this.queue.findIndex((job) => job.track.id === id);
    if (index !== -1) this.queue.splice(index, 1);
    this.running.get(id)?.abort();
    this.running.delete(id);
    for (const file of [this.audioFile(id), this.artworkFile(id)]) {
      if (file.exists) file.delete();
    }
    this.set(id, null);
  }

  /** Removes everything downloaded that isn't in `keep`, e.g. tracks deleted from the library. */
  prune(keep: Set<number>) {
    this.init();
    for (const [id, state] of this.states) {
      if (!keep.has(id) && state.status === 'downloaded') this.remove(id);
    }
  }

  removeAll() {
    this.init();
    this.queue.length = 0;
    for (const id of [...this.states.keys()]) this.remove(id);
  }

  private pump() {
    while (this.running.size < CONCURRENCY) {
      const job = this.queue.shift();
      if (!job) return;
      const controller = new AbortController();
      this.running.set(job.track.id, controller);
      void this.run(job, controller.signal).finally(() => {
        if (this.running.get(job.track.id) === controller) {
          this.running.delete(job.track.id);
        }
        this.pump();
      });
    }
  }

  private async run({ track, connection }: Job, signal: AbortSignal) {
    const { id } = track;
    const headers = authHeaders(connection);
    // Android writes straight into the destination, so a failed download would look finished.
    const partial = new File(this.dir, `${id}${AUDIO_EXT}${PARTIAL_EXT}`);
    let lastReported = 0;
    this.set(id, { status: 'downloading', progress: 0 });
    try {
      if (partial.exists) partial.delete();
      await File.downloadFileAsync(audioUrl(connection, id), partial, {
        headers,
        idempotent: true,
        signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const total =
            totalBytes > 0 ? totalBytes : (track.audioSizeBytes ?? 0);
          if (!total || signal.aborted) return;
          const progress = Math.min(1, bytesWritten / total);
          // Every few percent is plenty for a progress ring.
          if (progress - lastReported < 0.03) return;
          lastReported = progress;
          this.set(id, { status: 'downloading', progress });
        },
      });
      if (track.audioSizeBytes && partial.size !== track.audioSizeBytes) {
        throw new Error(
          `Got ${partial.size} bytes instead of ${track.audioSizeBytes}`,
        );
      }
      if (track.hasArtwork) {
        try {
          await File.downloadFileAsync(
            artworkUrl(connection, id),
            this.artworkFile(id),
            { headers, idempotent: true, signal },
          );
        } catch {
          // The artwork's nice to have; the remote one still shows when online.
        }
      }
      if (signal.aborted) throw signal.reason;
      partial.moveSync(this.audioFile(id));
      this.set(id, { status: 'downloaded', bytes: this.audioFile(id).size });
    } catch (error) {
      if (partial.exists) partial.delete();
      // Removed while it downloaded: remove() already cleaned up.
      if (signal.aborted) return;
      this.set(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const downloads = new Downloads();

export function useDownloads(): ReadonlyMap<number, DownloadState> {
  return useSyncExternalStore(downloads.subscribe, downloads.getSnapshot);
}

export function useDownloadState(id: number): DownloadState | undefined {
  return useDownloads().get(id);
}

export function useDownloadSummary() {
  const states = useDownloads();
  let count = 0;
  let bytes = 0;
  let inProgress = 0;
  for (const state of states.values()) {
    if (state.status === 'downloaded') {
      count++;
      bytes += state.bytes;
    } else if (state.status === 'queued' || state.status === 'downloading') {
      inProgress++;
    }
  }
  return { count, bytes, inProgress };
}
