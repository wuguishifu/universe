import { invoke } from '@tauri-apps/api/core';

/** Mirrors `Status` in src-tauri/src/lib.rs. */
export type CaptureStatus = {
  version: string;
  bufferSeconds: number;
  recording: boolean;
};

/** Typed wrappers for the Rust commands registered in src-tauri/src/lib.rs. */
export const commands = {
  getStatus: () => invoke<CaptureStatus>('get_status'),
};
