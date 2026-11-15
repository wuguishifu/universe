import { LazyStore } from '@tauri-apps/plugin-store';
import type { Storage } from 'redux-persist';

/** The store file, in the app's data folder. Rust reads it too: see src-tauri/src/settings.rs. */
export const STORE_FILE = 'preferences.json';

const store = new LazyStore(STORE_FILE);

/**
 * redux-persist storage backed by a Tauri store: a JSON file both the UI and Rust can read.
 * Used with `serialize: false`, so each persisted slice is kept as JSON, not as a string of it,
 * which is what lets Rust read it.
 */
export const tauriStorage: Storage = {
  getItem: (key: string) => store.get(key),
  async setItem(key: string, value: unknown) {
    await store.set(key, value);
    await store.save();
  },
  async removeItem(key: string) {
    await store.delete(key);
    await store.save();
  },
};
