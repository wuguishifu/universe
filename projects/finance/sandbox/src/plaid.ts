import { Plaid, PlaidClient, PlaidEnvironment, PlaidError } from 'plaid';
import { z } from 'zod';

import { env } from './env.ts';

export { Plaid };

export const plaid = new PlaidClient({
  environment:
    env.PLAID_ENV === 'production'
      ? PlaidEnvironment.Production
      : PlaidEnvironment.Sandbox,
  clientId: env.PLAID_CLIENT_ID,
  secret: env.PLAID_CLIENT_SECRET,
  timeoutInSeconds: 180,
});

const errorBodySchema = z.object({
  error_type: z.string(),
  error_code: z.string(),
  error_message: z.string(),
});

const errorBody = (error: unknown) =>
  error instanceof PlaidError
    ? errorBodySchema.safeParse(error.body).data
    : undefined;

export const plaidErrorCode = (error: unknown): string | undefined =>
  errorBody(error)?.error_code;

// only logs the response body: the full error can carry request headers with the secret
export const formatPlaidError = (error: unknown): string => {
  const body = errorBody(error);
  if (body && error instanceof PlaidError) {
    return `${body.error_type}/${body.error_code}: ${body.error_message} (request ${error.requestId ?? 'n/a'})`;
  }
  if (error instanceof PlaidError) {
    return `HTTP ${error.statusCode ?? '?'}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};
