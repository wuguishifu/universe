import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors `Status` in src-tauri/src/lib.rs. */
export type CaptureStatus = {
  version: string;
  bufferSeconds: number;
  recording: boolean;
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
