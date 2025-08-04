import { useEffect } from 'react';

export function useOnClient(callback: () => void, deps: unknown[]) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    callback();
  }, [callback, deps]);
}
