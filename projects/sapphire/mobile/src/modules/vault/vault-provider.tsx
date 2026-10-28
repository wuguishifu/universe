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

import * as SapphireProxy from '@projects/sapphire-proxy';
import * as SapphireVault from '@projects/sapphire-vault';

import { useTailnet } from '../tailnet/tailnet-provider';

/** How long the vault stays unlocked while the app is in the background. */
const AUTO_LOCK_MS = 5 * 60 * 1000;
const SYNC_ATTEMPTS = 3;
const SYNC_RETRY_MS = 3000;

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
 * spends AUTO_LOCK_MS in the background, or when a sync changes the cache (so the list never
 * disagrees with the secrets read from it). On Android, where there's no vault, it does nothing.
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
    if (SapphireVault.isAvailable) {
      void refreshState();
    }
  }, [refreshState]);

  const syncNow = useCallback(() => {
    inFlightSync.current ??= (async () => {
      setSync({ status: 'syncing' });
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            const { changed } = await SapphireVault.sync();
            if (changed) {
              setItems(null);
            }
            break;
          } catch (error) {
            // Right after foregrounding, the node can take a few seconds to reconnect.
            const network =
              SapphireVault.errorCode(error) ===
              SapphireVault.VaultErrorCode.Network;
            if (!network || attempt === SYNC_ATTEMPTS) {
              throw error;
            }
            SapphireProxy.log(
              `app: sync attempt ${attempt} failed, retrying in ${SYNC_RETRY_MS}ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_MS));
          }
        }
        setSync({ status: 'idle' });
      } catch (error) {
        // Superseded by a login or logout, which syncs (or doesn't) on its own.
        const superseded =
          SapphireVault.errorCode(error) ===
          SapphireVault.VaultErrorCode.AccountChanged;
        setSync(
          superseded
            ? { status: 'idle' }
            : { status: 'error', message: SapphireVault.errorMessage(error) },
        );
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
    SapphireProxy.log('app: syncing now that the tailnet is running');
    void syncNow();
    // Only after the background: Face ID prompts take the app from active to inactive and back,
    // and syncing then would relock the list whenever the cache changed, asking for Face ID again.
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous === 'background') {
        SapphireProxy.log('app: syncing after coming back from the background');
        void syncNow();
      }
      previous = next;
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

  // Native unlock waits for a running sync after Face ID, so the prompt shows straight away.
  const unlock = useCallback(async () => {
    // Face ID, plus any wait for a running sync.
    const started = Date.now();
    SapphireProxy.log('app: unlocking');
    try {
      setItems(await SapphireVault.unlock());
      SapphireProxy.log(`app: unlocked in ${Date.now() - started}ms`);
      return true;
    } catch (error) {
      SapphireProxy.log(
        `app: unlock failed after ${Date.now() - started}ms: ${SapphireVault.errorMessage(error)}`,
      );
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
      // A sync from before the login gets discarded natively; don't join it.
      await inFlightSync.current;
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
