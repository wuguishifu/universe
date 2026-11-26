import type { Metadata } from 'next';

import { Connections } from '../../../modules/connections/connections';
import { PageHeader } from '../../../modules/layout/page-header';
import { Profile } from '../../../modules/settings/profile';

export const metadata: Metadata = { title: 'Settings · Finance' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <Profile />
        <Connections />
      </div>
    </>
  );
}
