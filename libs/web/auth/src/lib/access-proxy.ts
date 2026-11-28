import {
  convexAuthNextjsMiddleware,
  type ConvexAuthNextjsMiddlewareContext,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
  type RouteMatcherParam,
} from '@convex-dev/auth/nextjs/server';
import { fetchQuery } from 'convex/nextjs';

import { api } from '@platform/convex-contracts';

import {
  type AccessApp,
  DEFAULT_HOME_PATH,
  DEFAULT_NO_ACCESS_PATH,
  DEFAULT_SIGN_IN_PATH,
  REDIRECT_PARAM,
  safeRedirectPath,
} from './paths';

export type AccessProxyOptions = {
  /** The app to check the user's grant for. */
  app: AccessApp;
  /**
   * The routes that need access, as `createRouteMatcher` patterns (e.g. `['/album(.*)']`). Leave
   * unset to protect everything but the sign-in and no-access pages.
   */
  protectedRoutes?: RouteMatcherParam;
  signInPath?: string;
  noAccessPath?: string;
  /** Where to send someone after sign-in when they weren't heading anywhere. */
  homePath?: string;
  /** How long the auth cookies last. Defaults to 30 days. */
  cookieMaxAgeSeconds?: number;
};

/**
 * The `proxy.ts` default export for a Next app that signs in with Convex Auth:
 *
 *   export default createAccessProxy({ app: 'janktm', protectedRoutes: ['/album(.*)'] });
 *   export const config = { matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'] };
 *
 * - Signed out on a protected page: to the sign-in page, which comes back after sign-in.
 * - Signed in without a grant for `app`: to the no-access page (<NoAccess />).
 * - On the sign-in or no-access page when that doesn't apply: back into the app.
 *
 * It also serves /api/auth, which Convex Auth's client signs in and refreshes through, keeping its
 * tokens in httpOnly cookies.
 *
 * This only gates pages. The app's Convex functions have to check the grant too (appQuery and
 * appMutation in convex/access/functions.ts), since anyone can call them directly.
 */
export function createAccessProxy({
  app,
  protectedRoutes,
  signInPath = DEFAULT_SIGN_IN_PATH,
  noAccessPath = DEFAULT_NO_ACCESS_PATH,
  homePath = DEFAULT_HOME_PATH,
  cookieMaxAgeSeconds = 60 * 60 * 24 * 30,
}: AccessProxyOptions) {
  const isSignInPage = createRouteMatcher([signInPath]);
  const isNoAccessPage = createRouteMatcher([noAccessPath]);
  const isProtected = protectedRoutes
    ? createRouteMatcher(protectedRoutes)
    : () => true;

  return convexAuthNextjsMiddleware(
    async (request, { convexAuth }) => {
      if (isSignInPage(request)) {
        const status = await accessStatus(app, convexAuth);
        if (status === 'signedOut') return undefined;
        if (status === 'noAccess') {
          return nextjsMiddlewareRedirect(request, noAccessPath);
        }
        const redirectTo = request.nextUrl.searchParams.get(REDIRECT_PARAM);
        return nextjsMiddlewareRedirect(
          request,
          safeRedirectPath(redirectTo, homePath),
        );
      }

      if (isNoAccessPage(request)) {
        const status = await accessStatus(app, convexAuth);
        if (status === 'signedOut') {
          return nextjsMiddlewareRedirect(request, signInPath);
        }
        if (status === 'ok') {
          return nextjsMiddlewareRedirect(request, homePath);
        }
        return undefined;
      }

      if (!isProtected(request)) return undefined;

      const status = await accessStatus(app, convexAuth);
      if (status === 'signedOut') {
        const { pathname, search } = request.nextUrl;
        const params = new URLSearchParams({
          [REDIRECT_PARAM]: pathname + search,
        });
        return nextjsMiddlewareRedirect(request, `${signInPath}?${params}`);
      }
      if (status === 'noAccess') {
        return nextjsMiddlewareRedirect(request, noAccessPath);
      }
      return undefined;
    },
    { cookieConfig: { maxAge: cookieMaxAgeSeconds } },
  );
}

/** The middleware has already refreshed the token if it needed to, so one query settles it. */
async function accessStatus(
  app: AccessApp,
  convexAuth: ConvexAuthNextjsMiddlewareContext,
) {
  const token = await convexAuth.getToken();
  if (!token) return 'signedOut';
  const { status } = await fetchQuery(
    api.access.viewer.status,
    { app },
    { token },
  );
  return status;
}
