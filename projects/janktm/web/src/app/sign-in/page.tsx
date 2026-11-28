import type { Metadata } from 'next';

import { REDIRECT_PARAM, safeRedirectPath, SignInForm } from '@libs/web-auth';

export const metadata: Metadata = { title: 'Sign in · Jank™' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const redirectTo = safeRedirectPath(
    (await searchParams)[REDIRECT_PARAM],
    '/album',
  );
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <SignInForm appName="Jank™" redirectTo={redirectTo} />
    </main>
  );
}
