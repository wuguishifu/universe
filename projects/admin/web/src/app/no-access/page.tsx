import type { Metadata } from 'next';

import { NoAccess } from '@libs/web-auth';

export const metadata: Metadata = { title: 'No access · Admin' };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <NoAccess appName="Admin" />
    </main>
  );
}
