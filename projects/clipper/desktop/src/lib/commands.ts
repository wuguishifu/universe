import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors `WindowInfo` in crates/capture/src/window_list.rs. */
export type WindowInfo = {
  hwnd: number;
  title: string;
  exe: string;
  pid: number;
};

/** Mirrors `CaptureSource` in crates/capture/src/recorder.rs. */
export type CaptureSource =
  { kind: 'display' } | ({ kind: 'window' } & WindowInfo);

/** Mirrors `AudioApp` in crates/capture/src/audio.rs. */
export type AudioApp = { pid: number; name: string };

/** Mirrors `AudioSource` in crates/capture/src/audio.rs: one audio track. */
export type AudioSource =
  { kind: 'desktop' } | { kind: 'microphone' } | ({ kind: 'app' } & AudioApp);

/** Mirrors `TrackSettings` in src-tauri/src/lib.rs: the tracks asked for. */
export type TrackSettings = { microphone: boolean; apps: AudioApp[] };

/** Mirrors `Status` in src-tauri/src/lib.rs. */
export type CaptureStatus = {
  version: string;
  bufferSeconds: number;
  recording: boolean;
  source: CaptureSource;
  /** The tracks being recorded, in the order they're saved (after the mix). */
  tracks: AudioSource[];
  trackSettings: TrackSettings;
  /** Tracks that couldn't be captured, and are silent. */
  trackWarnings: string[];
  bufferedSeconds: number;
  lastError: string | null;
  clipsDir: string;
  shortcut: string;
};

/** Mirrors `ClipEvent` in src-tauri/src/lib.rs. */
export type ClipEvent = {
  path: string | null;
  error: string | null;
};

/** Typed wrappers for the Rust commands registered in src-tauri/src/lib.rs. */
export const commands = {
  getStatus: () => invoke<CaptureStatus>('get_status'),
  listWindows: () => invoke<WindowInfo[]>('list_capture_windows'),
  /** Switches what's recorded; the buffer starts over. */
  setSource: (source: CaptureSource) => invoke<void>('set_source', { source }),
  /** Apps with audio sessions, which can each get a track. */
  listAudioApps: () => invoke<AudioApp[]>('list_capture_audio_apps'),
  /** Changes the extra tracks; the buffer starts over. */
  setTracks: (settings: TrackSettings) =>
    invoke<void>('set_tracks', { settings }),
  /** Starts saving; the result arrives as a clip event. */
  saveClip: () => invoke<void>('save_clip'),
};

/** Calls `handler` for every clip saved or failed, from the button or the shortcut. */
export function onClip(handler: (event: ClipEvent) => void) {
  const unlisten = [
    listen<ClipEvent>('clip-saved', (e) => handler(e.payload)),
    listen<ClipEvent>('clip-failed', (e) => handler(e.payload)),
  ];
  return () => unlisten.forEach((p) => p.then((stop) => stop()));
}
