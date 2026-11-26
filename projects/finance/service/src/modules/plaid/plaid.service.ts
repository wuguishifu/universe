import { Injectable } from '@nestjs/common';
import { Plaid, PlaidClient, PlaidEnvironment, PlaidError } from 'plaid';
import { z } from 'zod';

import { EnvironmentService } from '../../config/environment';

export { Plaid };

@Injectable()
export class PlaidService {
  public readonly client: PlaidClient;

  constructor(environmentService: EnvironmentService) {
    const { plaidEnv, plaidClientId, plaidClientSecret } =
      environmentService.environment;
    this.client = new PlaidClient({
      environment:
        plaidEnv === 'production'
          ? PlaidEnvironment.Production
          : PlaidEnvironment.Sandbox,
      clientId: plaidClientId,
      secret: plaidClientSecret,
      timeoutInSeconds: 180,
    });
  }
}

const errorBodySchema = z.object({
  error_type: z.string(),
  error_code: z.string(),
  error_message: z.string(),
});

export const plaidErrorBody = (error: unknown) =>
  error instanceof PlaidError
    ? errorBodySchema.safeParse(error.body).data
    : undefined;

export const plaidErrorCode = (error: unknown): string | undefined =>
  plaidErrorBody(error)?.error_code;

/** Only the response body: the full error can carry request headers with the secret. */
export const formatPlaidError = (error: unknown): string => {
  const body = plaidErrorBody(error);
  if (body && error instanceof PlaidError) {
    return `${body.error_type}/${body.error_code}: ${body.error_message} (request ${error.requestId ?? 'n/a'})`;
  }
  if (error instanceof PlaidError) {
    return `HTTP ${error.statusCode ?? '?'}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};
