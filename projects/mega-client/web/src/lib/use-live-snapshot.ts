import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  type Snapshot,
  snapshotSchema,
  StreamEvent,
} from '@projects/mega-client-contracts';

import { api, expect } from './api';

export const SNAPSHOT_KEY = ['snapshot'] as const;

/** The service pings every 25s, so this long without any event means the stream is down. */
const STALE_AFTER_MS = 90_000;

export type Connection = 'connecting' | 'live' | 'disconnected';

const newer = (current: Snapshot | undefined, snapshot: Snapshot) =>
  current && current.generatedAt > snapshot.generatedAt ? current : snapshot;

/** Changes answer with a snapshot and the stream sends it too: whichever is newer wins. */
export function setSnapshot(queryClient: QueryClient, snapshot: Snapshot) {
  queryClient.setQueryData<Snapshot>(SNAPSHOT_KEY, (current) =>
    newer(current, snapshot),
  );
}

/**
 * The page's data, kept current by the /api/stream SSE stream: the service sends a snapshot on
 * connect and whenever the transfers or the account change. EventSource reconnects by itself
 * when the connection errors; one that stays open but goes quiet is replaced here.
 */
export function useLiveSnapshot(): {
  snapshot: Snapshot | undefined;
  connection: Connection;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');

  const { data, error } = useQuery({
    queryKey: SNAPSHOT_KEY,
    // The stream can get a newer snapshot in before this answers.
    queryFn: async () =>
      newer(
        queryClient.getQueryData<Snapshot>(SNAPSHOT_KEY),
        await expect(api.snapshot(), 200),
      ),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let lastEventAt = Date.now();
    let source: EventSource;

    const alive = () => {
      lastEventAt = Date.now();
      setConnection('live');
    };
    const connect = () => {
      lastEventAt = Date.now();
      source = new EventSource('/api/stream');
      source.addEventListener(StreamEvent.Snapshot, (event) => {
        const parsed = snapshotSchema.safeParse(JSON.parse(event.data));
        if (parsed.success) {
          setSnapshot(queryClient, parsed.data);
        } else {
          // eslint-disable-next-line no-console
          console.error('Unexpected snapshot', parsed.error);
        }
        alive();
      });
      source.addEventListener(StreamEvent.Ping, alive);
      source.onerror = () => setConnection('connecting');
    };
    connect();

    // A connection can stay open without delivering anything or erroring, and EventSource only
    // reconnects on errors. The new connection starts with a fresh snapshot.
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt > STALE_AFTER_MS) {
        setConnection('disconnected');
        source.close();
        connect();
      }
    }, 10_000);

    return () => {
      clearInterval(watchdog);
      source.close();
    };
  }, [queryClient]);

  return { snapshot: data, connection, error };
}
