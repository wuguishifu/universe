import { initClient } from '@ts-rest/core';

import { megaRootRouter } from '@projects/mega-client-contracts';

/** Same origin: the service serves this page, and the Vite dev server proxies /api to it. */
export const api = initClient(megaRootRouter, { baseUrl: '' });

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
  throw new Error(
    messageOf(response.body) ?? `Request failed (${response.status})`,
  );
}
