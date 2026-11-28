# @libs/web-auth

Invite-only sign-in for Next apps on the shared Convex deployment, using Convex Auth (`platform/convex/app/convex/auth.ts`).

Accounts are deployment-wide: one account works in every app. What someone can use is set per app by their grants (`convex/access`), which you manage in admin-web (`projects/admin/web`). Signing up needs at least one grant. Each app checks for its own.

## Adding auth to an app

1. Add the app to `appValidator` and `APP_LABELS` in `platform/convex/app/convex/access/apps.ts`.
2. Add `@libs/web-auth` to the app's `package.json`, add a reference to `libs/web/auth` in its `tsconfig.json`, and add `@source "…/libs/web/auth/";` next to the `libs/web/ui` one in its global CSS.
3. Wrap the root layout:

   ```tsx
   import { ConvexAuthClientProvider } from '@libs/web-auth';
   import { ConvexAuthNextjsServerProvider } from '@libs/web-auth/server';

   <ConvexAuthNextjsServerProvider>
     <html><body><ConvexAuthClientProvider>{children}</ConvexAuthClientProvider></body></html>
   </ConvexAuthNextjsServerProvider>
   ```

4. Add `src/proxy.ts`:

   ```ts
   import { createAccessProxy } from '@libs/web-auth/server';

   // Leave out protectedRoutes to protect every page.
   export default createAccessProxy({ app: 'myapp', protectedRoutes: ['/private(.*)'] });
   export const config = { matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'] };
   ```

5. Add a `/sign-in` page that renders `<SignInForm redirectTo={safeRedirectPath(searchParams.redirectTo)} />`, and a `/no-access` page that renders `<NoAccess appName="…" />`. `projects/admin/web` has both.
6. Check access in Convex as well. The proxy only gates pages, and anyone can call a public function directly. Build the app's functions with `appQuery('myapp')` / `appMutation('myapp')` from `convex/access/functions.ts`, or call `requireAppAccess`.

## Deployment setup

These go on the Convex deployment (`nx convex convex-app -- env set …`):

- `JWT_PRIVATE_KEY` and `JWKS`: `node tools/scripts/convex-auth-keys.mjs` (add `--prod` for prod).
- `SITE_URL`: Convex Auth needs this before it emails a code. Any of the apps' URLs works, since the emails carry only a code, not a link. Include the scheme (`https://example.com`, not `example.com`). Without it, sending a code crashes with `object null is not iterable`.
- `RESEND_API_KEY`: used by the Resend component.
- `AUTH_EMAIL_FROM`: e.g. `Universe <auth@example.com>`, on a domain verified in Resend.

To create the first admin, before admin-web has anyone in it:

```sh
nx convex convex-app -- run access/internal:grant '{"email": "you@example.com", "app": "admin"}'
```
