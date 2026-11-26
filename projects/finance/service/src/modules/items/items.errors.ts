import type { ErrorBody } from '@projects/finance-contracts';

import { convexErrorCode } from '../common/convex.service';
import { plaidErrorBody } from '../plaid/plaid.service';

export type ErrorStatus = 400 | 401 | 404 | 409 | 502;

/** An error with a response for the web app. Anything else becomes a 500. */
export class ItemsError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }

  toResponse(): { status: ErrorStatus; body: ErrorBody } {
    return {
      status: this.status,
      body: { message: this.message, code: this.code },
    };
  }
}

const CONVEX_ERRORS: Record<string, [ErrorStatus, string]> = {
  ITEM_NOT_FOUND: [404, 'No such item'],
  ITEM_BELONGS_TO_ANOTHER_USER: [409, 'That item is linked to another user'],
  USER_NOT_FOUND: [401, 'No such user'],
};

/** Turns the errors convex and Plaid throw on purpose into ItemsErrors; rethrows the rest. */
export function toItemsError(error: unknown): ItemsError {
  if (error instanceof ItemsError) return error;

  const convexCode = convexErrorCode(error);
  const known = convexCode ? CONVEX_ERRORS[convexCode] : undefined;
  if (convexCode && known)
    return new ItemsError(known[0], convexCode, known[1]);

  // Plaid's error_message is meant for developers and is safe to pass on; the rest of the error
  // isn't (see formatPlaidError).
  const plaid = plaidErrorBody(error);
  if (plaid) return new ItemsError(502, plaid.error_code, plaid.error_message);

  throw error;
}
