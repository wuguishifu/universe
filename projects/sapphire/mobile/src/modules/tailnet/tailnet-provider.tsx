import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';

import * as SapphireProxy from '@projects/sapphire-proxy';

const HOSTNAME = 'sapphire-mobile';
const POLL_INTERVAL_MS = 2000;

type Tailnet =
  | { phase: 'starting' }
  | { phase: 'error'; message: string }
  | {
      phase: 'started';
      proxyPort: number;
      status?: SapphireProxy.TailnetStatus;
    };

const TailnetContext = createContext<Tailnet>({ phase: 'starting' });

export function useTailnet() {
  return useContext(TailnetContext);
}

/**
 * Starts the embedded tailnet node once for the app's lifetime and polls its
 * status while the app is in the foreground.
 */
export function TailnetProvider({ children }: { children: ReactNode }) {
  const [tailnet, setTailnet] = useState<Tailnet>({ phase: 'starting' });

  useEffect(() => {
    SapphireProxy.start(HOSTNAME).then(
      (proxyPort) => setTailnet({ phase: 'started', proxyPort }),
      (error: Error) => setTailnet({ phase: 'error', message: error.message }),
    );
  }, []);

  const started = tailnet.phase === 'started';
  useEffect(() => {
    if (!started) {
      return;
    }

    let foreground = AppState.currentState === 'active';
    let lastState: SapphireProxy.BackendState | undefined;
    const poll = async () => {
      if (!foreground) {
        return;
      }
      try {
        const status = await SapphireProxy.status();
        // When the app noticed, which can trail tsnet's own state change by a poll interval.
        if (status.backendState !== lastState) {
          lastState = status.backendState;
          SapphireProxy.log(`app: tailnet is ${status.backendState}`);
        }
        setTailnet((t) => (t.phase === 'started' ? { ...t, status } : t));
      } catch {
        // Transient while the backend restarts; the next poll will catch up.
      }
    };

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      void poll();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [started]);

  return (
    <TailnetContext.Provider value={tailnet}>
      {children}
    </TailnetContext.Provider>
  );
}
