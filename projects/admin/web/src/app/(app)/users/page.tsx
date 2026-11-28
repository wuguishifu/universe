import type { Metadata } from 'next';

import { UsersTable } from '../../../modules/users/users-table';

export const metadata: Metadata = { title: 'Users · Admin' };

export default function UsersPage() {
  return <UsersTable />;
}
