import { createAccessProxy } from '@libs/web-auth/server';

/**
 * Game night stays public (a party's code is its only gate). The album needs a signed-in user with
 * a `janktm` grant, and so do its convex queries (convex/album/auth.ts).
 */
export default createAccessProxy({
  app: 'janktm',
  protectedRoutes: ['/album(.*)'],
  homePath: '/album',
});

export const config = {
  // Everything except static files and Next's internals.
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
