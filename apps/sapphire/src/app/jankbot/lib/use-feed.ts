'use client';

import { useEffect, useState } from 'react';
import {
  type FeedGuild,
  type FeedUtterance,
  parseFeedServerMessage,
  RUBY_FEED_HISTORY_SIZE,
} from '@universe/contracts-ruby';
import { getFeedConnection } from '../actions';

export type FeedStatus = 'connecting' | 'live' | 'reconnecting';

type FeedState = {
  status: FeedStatus;
  /** Set when retrying won't help, e.g. no Discord account is connected. */
  error: string | null;
  guilds: FeedGuild[];
  utterances: FeedUtterance[];
};

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** Ruby's live transcript feed. Reconnects with backoff, fetching a fresh ticket each time. */
export function useFeed(): FeedState {
  const [state, setState] = useState<FeedState>({
    status: 'connecting',
    error: null,
    guilds: [],
    utterances: [],
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = MIN_RETRY_MS;
    let disposed = false;

    const scheduleRetry = () => {
      if (disposed) return;
      setState((prev) => ({ ...prev, status: 'reconnecting' }));
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    };

    const connect = async () => {
      let connection;
      try {
        connection = await getFeedConnection();
      } catch {
        scheduleRetry();
        return;
      }
      if (disposed) return;
      if (!connection.success) {
        setState((prev) => ({ ...prev, error: connection.error }));
        return;
      }

      socket = new WebSocket(connection.url);
      socket.onmessage = (event) => {
        const message = parseFeedServerMessage(String(event.data));
        switch (message?.type) {
          case 'ready':
            retryMs = MIN_RETRY_MS;
            setState({
              status: 'live',
              error: null,
              guilds: message.guilds,
              utterances: message.utterances,
            });
            break;
          case 'utterance':
            setState((prev) => ({
              ...prev,
              utterances: appendCapped(prev.utterances, message.utterance),
            }));
            break;
        }
      };
      // Every close, including an expired ticket, is retried with a fresh ticket.
      socket.onclose = scheduleRetry;
    };

    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return state;
}

/** Keeps the same per-server limit as ruby, so a long-open tab doesn't grow forever. */
function appendCapped(
  utterances: FeedUtterance[],
  utterance: FeedUtterance,
): FeedUtterance[] {
  const next = [...utterances, utterance];
  const sameGuild = next.filter((u) => u.guildId === utterance.guildId);
  if (sameGuild.length <= RUBY_FEED_HISTORY_SIZE) return next;
  const oldest = sameGuild[0];
  return next.filter((u) => u !== oldest);
}
