import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from '@convex-dev/auth/nextjs/server';

const isSignInPage = createRouteMatcher(['/sign-in']);

/**
 * Everything but /sign-in needs a signed-in user. Also serves /api/auth, which Convex Auth's client
 * calls to sign in and refresh, keeping its tokens in httpOnly cookies.
 */
export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const signedIn = await convexAuth.isAuthenticated();
    if (isSignInPage(request) && signedIn) {
      return nextjsMiddlewareRedirect(request, '/');
    }
    if (!isSignInPage(request) && !signedIn) {
      return nextjsMiddlewareRedirect(request, '/sign-in');
    }
    return undefined;
  },
  { cookieConfig: { maxAge: 60 * 60 * 24 * 30 } },
);

export const config = {
  // Everything except static files and Next's internals.
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
