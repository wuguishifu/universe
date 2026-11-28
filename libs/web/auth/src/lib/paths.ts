import type { FunctionArgs } from 'convex/server';

import type { api } from '@platform/convex-contracts';

/** An app on the Convex deployment, as granted in admin-web (convex/access/apps.ts). */
export type AccessApp = FunctionArgs<typeof api.access.viewer.status>['app'];

export const DEFAULT_SIGN_IN_PATH = '/sign-in';
export const DEFAULT_NO_ACCESS_PATH = '/no-access';
export const DEFAULT_HOME_PATH = '/';

/** The query param the proxy puts the page someone was heading to in, on the way to sign in. */
export const REDIRECT_PARAM = 'redirectTo';

/**
 * `value` when it's a path on this site, else `fallback`. Guards the sign-in redirect against
 * `?redirectTo=https://evil.example` and protocol-relative `//evil.example`.
 */
export function safeRedirectPath(
  value: unknown,
  fallback: string = DEFAULT_HOME_PATH,
): string {
  if (typeof value !== 'string') return fallback;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }
  return value;
}
