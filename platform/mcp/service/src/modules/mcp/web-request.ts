import type { FastifyReply, FastifyRequest } from 'fastify';

/** Describe the connection rather than the message, and the body is re-serialized. */
const SKIPPED_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

/**
 * The web-standard `Request` the MCP SDK takes, for a Fastify request whose body Fastify has
 * already parsed. It's aborted when the client goes away before the response is done.
 */
export function toWebRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  origin: string,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || SKIPPED_HEADERS.has(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }

  const abort = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) abort.abort();
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(new URL(request.url, origin), {
    method: request.method,
    headers,
    body:
      hasBody && request.body !== undefined
        ? JSON.stringify(request.body)
        : undefined,
    signal: abort.signal,
  });
}
