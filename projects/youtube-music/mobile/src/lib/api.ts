import { initClient } from '@ts-rest/core';
import { useMemo } from 'react';
import {
  musicRootRouter,
  trackArtworkPath,
  trackAudioPath,
} from '@projects/youtube-music-contracts';
import { useSettings } from './settings';

/** Where the server is and how to get in: everything needed to reach it outside React. */
export type Connection = { serverUrl: string; token: string };

export const authHeaders = ({ token }: Connection) => ({
  Authorization: `Bearer ${token}`,
});

export const createApi = (connection: Connection) =>
  initClient(musicRootRouter, {
    baseUrl: connection.serverUrl,
    baseHeaders: authHeaders(connection),
  });

export type Api = ReturnType<typeof createApi>;

export const audioUrl = ({ serverUrl }: Connection, trackId: number) =>
  `${serverUrl}${trackAudioPath(trackId)}`;

export const artworkUrl = ({ serverUrl }: Connection, trackId: number) =>
  `${serverUrl}${trackArtworkPath(trackId)}`;

/** For things that can't send headers, like the lock screen fetching artwork. */
export const artworkUrlWithToken = (connection: Connection, trackId: number) =>
  `${artworkUrl(connection, trackId)}?token=${encodeURIComponent(connection.token)}`;

export function useConnection(): Connection {
  const {
    settings: { serverUrl, token },
  } = useSettings();
  return useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
}

export function useApi(): Api {
  const connection = useConnection();
  return useMemo(() => createApi(connection), [connection]);
}

type Response = { status: number; body: unknown };

const hasStatus = <R extends Response, S extends number>(
  response: R,
  status: S,
): response is Extract<R, { status: S }> => response.status === status;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** `{ message }` from the handlers, or the first issue of a ts-rest validation error. */
const messageOf = (body: unknown): string | null => {
  if (!isRecord(body)) return null;
  if (typeof body.message === 'string') return body.message;
  const issues = isRecord(body.bodyResult) ? body.bodyResult.issues : null;
  const [issue] = Array.isArray(issues) ? issues : [];
  return isRecord(issue) && typeof issue.message === 'string'
    ? issue.message
    : null;
};

/** The body of a response with the expected status. Anything else throws, with the API's message. */
export async function expect<R extends Response, S extends R['status']>(
  request: Promise<R>,
  status: S,
): Promise<Extract<R, { status: S }>['body']> {
  const response = await request;
  if (hasStatus(response, status)) return response.body;
  if (response.status === 401) {
    throw new Error('The server rejected the token. Check it in Settings.');
  }
  throw new Error(
    messageOf(response.body) ?? `Request failed (${response.status})`,
  );
}
