import {
  type AudioMetadata,
  type AudioPlaylist,
  type AudioSource,
  createAudioPlaylist,
  setAudioModeAsync,
} from 'expo-audio';
import { useSyncExternalStore } from 'react';
import type { Track } from '@projects/youtube-music-contracts';
import {
  audioUrl,
  artworkUrlWithToken,
  authHeaders,
  type Connection,
} from './api';
import { downloads } from './downloads';
import { trackArtist, trackTitle } from './format';
import { normalizedVolume } from './loudness';
import { playOrder, shuffled, unshuffledUpcoming } from './queue-order';

export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerState = {
  /** In play order; the native playlist holds exactly these. */
  queue: Track[];
  /** Of the current track in `queue`, or -1 when there's nothing. */
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** What's playing, e.g. "Library" or a playlist's name. */
  context: string | null;
};

/**
 * The native playlist makes a player item per track, so a whole library would be slow to start.
 * Longer lists are played from the chosen track up to this many.
 */
const MAX_QUEUE = 300;
/** Pressing previous this far into a track restarts it instead. */
const RESTART_THRESHOLD_SEC = 3;

const LOOP = { off: 'none', all: 'all', one: 'single' } as const;

/**
 * Plays queues of tracks, from the phone when they're downloaded and streamed from the server when
 * not. Built on expo-audio's AudioPlaylist, which keeps playing in the background, moves on to the
 * next track by itself and drives the lock screen controls.
 *
 * The native playlist rebuilds itself (restarting the current track) when tracks are inserted or
 * removed before the current one, so changes to the queue only ever touch what comes after it.
 */
class Player {
  readonly playlist: AudioPlaylist = createAudioPlaylist({
    updateInterval: 250,
  });
  private state: PlayerState = {
    queue: [],
    index: -1,
    shuffle: false,
    repeat: 'off',
    context: null,
  };
  /** The queue before it was shuffled, to go back to. */
  private original: Track[] = [];
  private readonly listeners = new Set<() => void>();
  private connection: Connection = { serverUrl: '', token: '' };
  private normalize = true;
  private audioModeSet = false;
  private lockScreenActive = false;

  constructor() {
    this.playlist.addListener('trackChanged', ({ currentIndex }) => {
      this.setState({ index: currentIndex });
      this.applyCurrent();
    });
  }

  /** Called whenever the settings change. */
  configure({
    connection,
    normalizeVolume,
  }: {
    connection: Connection;
    normalizeVolume: boolean;
  }) {
    this.connection = connection;
    if (this.normalize !== normalizeVolume) {
      this.normalize = normalizeVolume;
      this.applyVolume();
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  get current(): Track | undefined {
    return this.state.queue[this.state.index];
  }

  /** Plays `tracks` (only the ready ones) starting at `startIndex`. */
  async play(
    tracks: Track[],
    startIndex: number,
    {
      shuffle = this.state.shuffle,
      context = null,
    }: { shuffle?: boolean; context?: string | null } = {},
  ) {
    const start = tracks[startIndex];
    const playable = tracks.filter((t) => t.status === 'ready');
    const from = start ? Math.max(0, playable.indexOf(start)) : 0;
    const { order, index } = playOrder(playable, from, {
      shuffle,
      limit: MAX_QUEUE,
    });
    if (index === -1) return;

    await this.ensureAudioMode();
    this.original = playable;
    this.playlist.clear();
    for (const track of order) this.playlist.add(this.source(track));
    this.setState({ queue: order, index, shuffle, context });
    this.playlist.skipTo(index);
    this.playlist.play();
    this.applyCurrent();
  }

  toggle() {
    if (this.state.index === -1) return;
    if (this.playlist.playing) this.playlist.pause();
    else this.playlist.play();
  }

  next() {
    this.playlist.next();
  }

  previous() {
    if (
      this.playlist.currentTime > RESTART_THRESHOLD_SEC ||
      this.state.index === 0
    ) {
      void this.playlist.seekTo(0);
    } else {
      this.playlist.previous();
    }
  }

  seek(seconds: number) {
    void this.playlist.seekTo(seconds);
  }

  jumpTo(index: number) {
    if (index === this.state.index) return;
    this.playlist.skipTo(index);
    if (!this.playlist.playing) this.playlist.play();
  }

  setShuffle(shuffle: boolean) {
    const { queue, index } = this.state;
    if (shuffle === this.state.shuffle) return;
    if (index === -1) {
      this.setState({ shuffle });
      return;
    }
    const upcoming = shuffle
      ? shuffled(queue.slice(index + 1))
      : unshuffledUpcoming(
          this.original,
          this.current,
          (a, b) => a.id === b.id,
        );
    this.replaceUpcoming(upcoming.slice(0, MAX_QUEUE - index - 1));
    this.setState({ shuffle });
  }

  cycleRepeat() {
    const next: Record<RepeatMode, RepeatMode> = {
      off: 'all',
      all: 'one',
      one: 'off',
    };
    const repeat = next[this.state.repeat];
    this.playlist.loop = LOOP[repeat];
    this.setState({ repeat });
  }

  /** Puts a track right after the current one, or starts playing it if nothing is. */
  playNext(track: Track) {
    if (track.status !== 'ready') return;
    if (this.state.index === -1) {
      void this.play([track], 0);
      return;
    }
    const upcoming = this.state.queue
      .slice(this.state.index + 1)
      .filter((t) => t.id !== track.id);
    this.replaceUpcoming([track, ...upcoming]);
  }

  addToQueue(track: Track) {
    if (track.status !== 'ready') return;
    if (this.state.index === -1) {
      void this.play([track], 0);
      return;
    }
    this.playlist.add(this.source(track));
    this.setState({ queue: [...this.state.queue, track] });
  }

  /** Removes an upcoming track. The current and earlier ones can't be removed. */
  removeFromQueue(index: number) {
    if (index <= this.state.index) return;
    this.playlist.remove(index);
    this.setState({
      queue: this.state.queue.filter((_, i) => i !== index),
    });
  }

  /** Swaps in edited or newly downloaded copies of tracks, for display. Playback isn't touched. */
  refreshTracks(byId: Map<number, Track>) {
    let changed = false;
    const queue = this.state.queue.map((track) => {
      const fresh = byId.get(track.id);
      if (fresh && fresh !== track) changed = true;
      return fresh ?? track;
    });
    if (!changed) return;
    this.setState({ queue });
    this.updateLockScreen();
  }

  /** Stops and empties the queue, e.g. when the server changes. */
  stop() {
    this.playlist.clear();
    this.original = [];
    this.setState({ queue: [], index: -1, context: null });
    if (this.lockScreenActive) {
      this.playlist.clearLockScreenControls();
      this.lockScreenActive = false;
    }
  }

  private replaceUpcoming(upcoming: Track[]) {
    const { queue, index } = this.state;
    for (let i = queue.length - 1; i > index; i--) this.playlist.remove(i);
    for (const track of upcoming) this.playlist.add(this.source(track));
    this.setState({ queue: [...queue.slice(0, index + 1), ...upcoming] });
  }

  private source(track: Track): AudioSource {
    const name = trackTitle(track);
    const local = downloads.localAudioUri(track.id);
    if (local) return { uri: local, name };
    return {
      uri: audioUrl(this.connection, track.id),
      headers: authHeaders(this.connection),
      name,
    };
  }

  private metadata(track: Track): AudioMetadata {
    const artwork =
      downloads.localArtworkUri(track.id) ??
      (track.hasArtwork && this.connection.serverUrl
        ? artworkUrlWithToken(this.connection, track.id)
        : undefined);
    return {
      title: trackTitle(track),
      artist: trackArtist(track),
      albumTitle: track.album ?? undefined,
      artworkUrl: artwork,
    };
  }

  /** Lock screen and volume, for whatever's current now. */
  private applyCurrent() {
    this.updateLockScreen();
    this.applyVolume();
  }

  private updateLockScreen() {
    const track = this.current;
    if (!track) return;
    if (this.lockScreenActive) {
      this.playlist.updateLockScreenMetadata(this.metadata(track));
    } else {
      this.playlist.setActiveForLockScreen(true, this.metadata(track), {
        showNextTrack: true,
        showPreviousTrack: true,
      });
      this.lockScreenActive = true;
    }
  }

  private applyVolume() {
    const track = this.current;
    this.playlist.volume =
      this.normalize && track ? normalizedVolume(track.loudnessLufs) : 1;
  }

  private async ensureAudioMode() {
    if (this.audioModeSet) return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Lock screen controls need exclusive audio.
      interruptionMode: 'doNotMix',
    });
    this.audioModeSet = true;
  }

  private setState(changes: Partial<PlayerState>) {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
}

export const player = new Player();

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState);
}

export function useCurrentTrack(): Track | undefined {
  const { queue, index } = usePlayer();
  return queue[index];
}
