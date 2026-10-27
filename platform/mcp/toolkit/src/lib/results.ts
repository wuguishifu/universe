import type { CallToolResult } from '@modelcontextprotocol/server';

type Response = { status: number; body: unknown };

export const textResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
});

export const jsonResult = (value: unknown): CallToolResult =>
  textResult(JSON.stringify(value, null, 2));

/** A failure the model sees and can react to, rather than a protocol error. */
export const errorResult = (message: string): CallToolResult => ({
  ...textResult(message),
  isError: true,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** `{ message }` from a handler, or the first issue of a ts-rest validation error. */
const messageOf = (body: unknown): string | null => {
  if (!isRecord(body)) return null;
  if (typeof body.message === 'string') return body.message;
  for (const result of Object.values(body)) {
    const issues = isRecord(result) ? result.issues : null;
    const [issue] = Array.isArray(issues) ? issues : [];
    if (isRecord(issue) && typeof issue.message === 'string') {
      return issue.message;
    }
  }
  return null;
};

/**
 * The tool result for a ts-rest call: the body as JSON when the response has the expected status
 * (or `done` for a 204), and otherwise an error with the API's message.
 */
export async function toolResult<R extends Response>(
  request: Promise<R>,
  status: R['status'],
  done = 'Done.',
): Promise<CallToolResult> {
  let response: R;
  try {
    response = await request;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return errorResult(`Couldn't reach the service: ${reason}`);
  }
  if (response.status !== status) {
    return errorResult(
      messageOf(response.body) ?? `Request failed (${response.status})`,
    );
  }
  return status === 204 ? textResult(done) : jsonResult(response.body);
}
