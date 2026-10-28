import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import * as SapphireVault from '@projects/sapphire-vault';

import { useTailnet } from '../tailnet/tailnet-provider';

/** How long the vault stays unlocked while the app is in the background. */
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SYNC_ATTEMPTS = 3;
const SYNC_RETRY_MS = 3000;
/** How long unlocking waits for a sync that's already running. */
const UNLOCK_SYNC_WAIT_MS = 5000;

export type SyncStatus =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'error'; message: string };

type VaultContextValue = {
  /** undefined until the native state has loaded. */
  state: SapphireVault.VaultState | undefined;
  sync: SyncStatus;
  /** Decrypted summaries while unlocked, null while locked. */
  items: SapphireVault.VaultItemSummary[] | null;
  syncNow: () => Promise<void>;
  /** Face ID. Resolves false if it was canceled or failed. */
  unlock: () => Promise<boolean>;
  lock: () => void;
  login: (serverUrl: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) {
    throw new Error('useVault must be used inside VaultProvider');
  }
  return value;
}

/**
 * Keeps the encrypted vault cache fresh and holds the unlocked item list.
 *
 * Syncs once the tailnet is running and again every time the app comes back to the foreground;
 * sync never needs Face ID. Unlocking decrypts summaries only, and they're dropped after the app
 * spends AUTO_LOCK_MS in the background.
 */
export function VaultProvider({ children }: { children: ReactNode }) {
  const tailnet = useTailnet();
  const running =
    tailnet.phase === 'started' && tailnet.status?.backendState === 'Running';

  const [state, setState] = useState<SapphireVault.VaultState>();
  const [sync, setSync] = useState<SyncStatus>({ status: 'idle' });
  const [items, setItems] = useState<SapphireVault.VaultItemSummary[] | null>(
    null,
  );
  const inFlightSync = useRef<Promise<void> | null>(null);

  const refreshState = useCallback(async () => {
    setState(await SapphireVault.getState());
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const syncNow = useCallback(() => {
    inFlightSync.current ??= (async () => {
      setSync({ status: 'syncing' });
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            await SapphireVault.sync();
            break;
          } catch (error) {
            // Right after foregrounding, the node can take a few seconds to reconnect.
            const network =
              SapphireVault.errorCode(error) ===
              SapphireVault.VaultErrorCode.Network;
            if (!network || attempt === SYNC_ATTEMPTS) {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_MS));
          }
        }
        setSync({ status: 'idle' });
      } catch (error) {
        setSync({
          status: 'error',
          message: SapphireVault.errorMessage(error),
        });
      } finally {
        await refreshState();
        inFlightSync.current = null;
      }
    })();
    return inFlightSync.current;
  }, [refreshState]);

  const loggedIn = state?.loggedIn ?? false;
  useEffect(() => {
    if (!running || !loggedIn) {
      return;
    }
    void syncNow();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void syncNow();
      }
    });
    return () => subscription.remove();
  }, [running, loggedIn, syncNow]);

  // JS timers don't run in the background, so compare timestamps on the way back.
  useEffect(() => {
    let backgroundedAt: number | undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAt = Date.now();
      } else if (next === 'active' && backgroundedAt !== undefined) {
        if (Date.now() - backgroundedAt >= AUTO_LOCK_MS) {
          setItems(null);
        }
        backgroundedAt = undefined;
      }
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    // A sync that's already running (e.g. the app just opened) is about to replace the cache.
    if (inFlightSync.current) {
      await Promise.race([
        inFlightSync.current,
        new Promise((resolve) => setTimeout(resolve, UNLOCK_SYNC_WAIT_MS)),
      ]);
    }
    try {
      setItems(await SapphireVault.unlock());
      return true;
    } catch (error) {
      const code = SapphireVault.errorCode(error);
      if (
        code === SapphireVault.VaultErrorCode.UserCanceled ||
        code === SapphireVault.VaultErrorCode.AuthenticationFailed
      ) {
        return false;
      }
      await refreshState();
      throw error;
    }
  }, [refreshState]);

  const lock = useCallback(() => setItems(null), []);

  const login = useCallback(
    async (serverUrl: string, email: string, password: string) => {
      await SapphireVault.login(serverUrl, email, password);
      setItems(null);
      await refreshState();
      await syncNow();
    },
    [refreshState, syncNow],
  );

  const logout = useCallback(async () => {
    setItems(null);
    await SapphireVault.logout();
    setSync({ status: 'idle' });
    await refreshState();
  }, [refreshState]);

  return (
    <VaultContext.Provider
      value={{ state, sync, items, syncNow, unlock, lock, login, logout }}
    >
      {children}
    </VaultContext.Provider>
  );
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function formatAgo(epochMs: number, now = Date.now()) {
  const minutes = Math.floor((now - epochMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
