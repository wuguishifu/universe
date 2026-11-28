import { ConvexError } from 'convex/values';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function formatDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

const MESSAGES: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  email_required: 'Enter an email address.',
  cannot_revoke_own_admin: "You can't revoke your own admin access.",
  cannot_delete_self: "You can't delete your own account.",
  has_finance_items:
    'They still have banks linked in Finance. Disconnect those there first.',
  forbidden: 'You no longer have admin access.',
  unauthenticated: "You're signed out.",
};

/** A message for an error from convex/access/admin.ts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    const code =
      typeof data === 'object' && data !== null && 'code' in data
        ? String(data.code)
        : null;
    if (code && MESSAGES[code]) return MESSAGES[code];
  }
  return 'Something went wrong. Try again.';
}
