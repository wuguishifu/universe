import type { Metadata } from 'next';

import { NoAccess } from '@libs/web-auth';

export const metadata: Metadata = { title: 'No access · Finance' };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <NoAccess appName="Finance" />
    </main>
  );
}
