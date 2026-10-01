'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardAccess } from '@universe/contracts-ruby';
import { getLeaderboardAccess } from '../actions';

/** Swap grants this long before they expire, so the Convex query never sees an expired one. */
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type AccessState = {
  access: LeaderboardAccess | null;
  /** Set when retrying won't help, e.g. no Discord account is connected. */
  error: string | null;
};

/**
 * The viewer's servers and leaderboard grant, refreshed before the grant expires (which also
 * picks up servers they've joined or left). Retries with backoff if ruby can't be reached.
 */
export function useLeaderboardAccess(): AccessState {
  const [state, setState] = useState<AccessState>({
    access: null,
    error: null,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = MIN_RETRY_MS;
    let disposed = false;

    const load = async () => {
      let result;
      try {
        result = await getLeaderboardAccess();
      } catch {
        if (disposed) return;
        timer = setTimeout(load, retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        return;
      }
      if (disposed) return;
      if (!result.success) {
        setState({ access: null, error: result.error });
        return;
      }

      retryMs = MIN_RETRY_MS;
      setState({ access: result.access, error: null });
      timer = setTimeout(
        load,
        Math.max(result.access.expiresAt - Date.now() - REFRESH_EARLY_MS, 0),
      );
    };

    void load();

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}
