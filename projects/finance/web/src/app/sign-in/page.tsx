import type { Metadata } from 'next';

import { SignInForm } from '../../modules/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in · Finance' };

export default function SignInPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <SignInForm />
    </main>
  );
}
