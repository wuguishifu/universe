import * as SecureStore from 'expo-secure-store';
import { Storage } from 'expo-sqlite/kv-store';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { z } from 'zod';

export type Settings = {
  /** e.g. http://music.tailnet.ts.net:3010. No trailing slash. */
  serverUrl: string;
  /** The service's API_TOKEN. */
  token: string;
  /** Keep every ready track on the phone, not just the ones downloaded by hand. */
  autoDownload: boolean;
  /** Turn loud tracks down to a common loudness. */
  normalizeVolume: boolean;
};

const storedSchema = z
  .object({
    serverUrl: z.string(),
    autoDownload: z.boolean(),
    normalizeVolume: z.boolean(),
  })
  .partial();

const TOKEN_KEY = 'apiToken';
const SETTINGS_KEY = 'settings';

const defaults: Settings = {
  serverUrl: '',
  token: '',
  autoDownload: false,
  normalizeVolume: true,
};

/** Both stores have synchronous reads, so settings are there on the first render. */
function load(): Settings {
  let stored: z.infer<typeof storedSchema> = {};
  try {
    const raw = Storage.getItemSync(SETTINGS_KEY);
    if (raw) stored = storedSchema.parse(JSON.parse(raw));
  } catch {
    // Unreadable settings are as good as none.
  }
  return { ...defaults, ...stored, token: readToken() };
}

function save({ token, ...rest }: Settings) {
  Storage.setItemSync(SETTINGS_KEY, JSON.stringify(rest));
  writeToken(token);
}

/**
 * The token goes in the keychain. A build without the keychain entitlement (an unsigned simulator
 * build) can't use it, so there it falls back to SQLite rather than failing to start.
 */
function readToken(): string {
  try {
    return SecureStore.getItem(TOKEN_KEY) ?? '';
  } catch {
    return Storage.getItemSync(TOKEN_KEY) ?? '';
  }
}

function writeToken(token: string) {
  try {
    SecureStore.setItem(TOKEN_KEY, token);
  } catch {
    Storage.setItemSync(TOKEN_KEY, token);
  }
}

export const normalizeServerUrl = (url: string) =>
  url.trim().replace(/\/+$/, '');

type SettingsContextValue = {
  settings: Settings;
  update: (changes: Partial<Settings>) => void;
  /** Whether there's a server to talk to. */
  configured: boolean;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);

  const update = useCallback((changes: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...changes };
      save(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      settings,
      update,
      configured: Boolean(settings.serverUrl && settings.token),
    }),
    [settings, update],
  );
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings needs a SettingsProvider');
  return value;
}
