import { createAccessProxy } from '@libs/web-auth/server';

/**
 * Every page but /sign-in and /no-access needs a signed-in user with a `finance` grant. Also serves
 * /api/auth, which Convex Auth's client calls to sign in and refresh, keeping its tokens in httpOnly
 * cookies.
 */
export default createAccessProxy({ app: 'finance' });

export const config = {
  // Everything except static files and Next's internals.
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
