import type { FunctionArgs } from 'convex/server';

import type { api } from '@platform/convex-contracts';

/** An app on the Convex deployment, as granted in admin-web (convex/access/apps.ts). */
export type AccessApp = FunctionArgs<typeof api.access.viewer.status>['app'];

export const DEFAULT_SIGN_IN_PATH = '/sign-in';
export const DEFAULT_NO_ACCESS_PATH = '/no-access';
export const DEFAULT_HOME_PATH = '/';

/** The query param the proxy puts the page someone was heading to in, on the way to sign in. */
export const REDIRECT_PARAM = 'redirectTo';

/** A placeholder origin to resolve paths against: if one leaves it, it leaves the site. */
const PROBE_ORIGIN = 'http://same-site.invalid';

/**
 * `value` when it's a path on this site, else `fallback`. Guards the sign-in redirect against
 * `?redirectTo=https://evil.example` and protocol-relative `//evil.example`.
 *
 * Checks the string the way a browser will read it rather than as written: the URL parser treats
 * `\` as `/` and drops tabs and newlines, so `/\evil.example` and `/<tab>/evil.example` are both
 * `//evil.example` to it. Control characters are refused outright, then the path has to resolve
 * to the same origin. What comes back is the parsed path, so it's exactly what was checked.
 */
export function safeRedirectPath(
  value: unknown,
  fallback: string = DEFAULT_HOME_PATH,
): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
