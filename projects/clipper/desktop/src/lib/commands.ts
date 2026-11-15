import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { SettingsState } from '../store/settings';

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

/** Mirrors `AudioSource` in crates/capture/src/audio.rs: one audio track. */
export type AudioSource =
  | { kind: 'desktop' }
  | { kind: 'microphone'; device: string | null }
  /** One process, e.g. the recorded game. */
  | { kind: 'app'; pid: number; name: string }
  /** Whichever process runs one of `exes`, whenever it's running, e.g. Discord. */
  | { kind: 'program'; name: string; exes: string[] };

/** Mirrors `TrackState` in crates/capture/src/audio.rs. */
export type TrackState =
  | { state: 'starting' }
  | { state: 'live' }
  /** Silent until something expected happens, e.g. Discord starting. */
  | { state: 'waiting'; reason: string }
  /** Silent because something's wrong, e.g. the chosen microphone isn't connected. */
  | { state: 'unavailable'; reason: string };

/** Mirrors `InputDevice` in crates/capture/src/audio.rs. */
export type InputDevice = {
  id: string;
  name: string;
  isDefault: boolean;
  isCommunicationsDefault: boolean;
};

/** Mirrors `Status` in src-tauri/src/lib.rs. */
export type CaptureStatus = {
  version: string;
  bufferSeconds: number;
  recording: boolean;
  source: CaptureSource;
  /** The tracks being recorded, in the order they're saved (after the mix). */
  tracks: AudioSource[];
  /** Each track's state, in the order of `tracks`. */
  trackStates: TrackState[];
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
  /** Sends the settings to the recorder. Mirrored by `Settings` in src-tauri/src/settings.rs. */
  applySettings: (settings: SettingsState) =>
    invoke<void>('apply_settings', { settings }),
  /** Each track's recent peak, 0 to 1, in the order of `CaptureStatus.tracks`. */
  getLevels: () => invoke<number[]>('get_levels'),
  listMicrophones: () => invoke<InputDevice[]>('list_microphones'),
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
