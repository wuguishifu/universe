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

/** Changes answer with a snapshot and the stream sends it too: whichever is newer wins. */
export function setSnapshot(queryClient: QueryClient, snapshot: Snapshot) {
  queryClient.setQueryData<Snapshot>(SNAPSHOT_KEY, (current) =>
    current && current.generatedAt > snapshot.generatedAt ? current : snapshot,
  );
}

/**
 * The page's data, kept current by the /api/stream SSE stream: the service sends a snapshot on
 * connect and whenever the transfers or the account change. EventSource reconnects by itself.
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
    queryFn: () => expect(api.snapshot(), 200),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let lastEventAt = Date.now();
    const source = new EventSource('/api/stream');

    const alive = () => {
      lastEventAt = Date.now();
      setConnection('live');
    };
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

    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt > STALE_AFTER_MS) {
        setConnection('disconnected');
      }
    }, 10_000);

    return () => {
      clearInterval(watchdog);
      source.close();
    };
  }, [queryClient]);

  return { snapshot: data, connection, error };
}
