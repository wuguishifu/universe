import Link from 'next/link';

import { PageHeader } from '../../modules/layout/page-header';

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Link your accounts in{' '}
          <Link href="/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      </div>
    </>
  );
}
