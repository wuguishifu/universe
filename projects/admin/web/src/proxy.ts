import { createAccessProxy } from '@libs/web-auth/server';

/** Every page but /sign-in and /no-access needs a signed-in user with an `admin` grant. */
export default createAccessProxy({ app: 'admin' });

export const config = {
  // Everything except static files and Next's internals.
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
