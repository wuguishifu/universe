'use client';

import { useCallback, useEffect, useState } from 'react';

const storageKey = (code: string) => `game-night:player:${code}`;

/**
 * Which player this device is playing as in a party, remembered in localStorage. `undefined`
 * until it's been read (so the page doesn't flash the join form), `null` when not joined.
 */
export function usePlayerId(code: string) {
  const [playerId, setPlayerIdState] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    try {
      setPlayerIdState(localStorage.getItem(storageKey(code)));
    } catch {
      setPlayerIdState(null);
    }
  }, [code]);

  const setPlayerId = useCallback(
    (id: string | null) => {
      setPlayerIdState(id);
      try {
        if (id) localStorage.setItem(storageKey(code), id);
        else localStorage.removeItem(storageKey(code));
      } catch {
        // Private browsing etc.: it just won't be remembered across reloads.
      }
    },
    [code],
  );

  return [playerId, setPlayerId] as const;
}
