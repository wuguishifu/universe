'use client';

import { useAuthActions } from '@convex-dev/auth/react';
import { useQuery } from 'convex/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Button, cn } from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

const NAV = [
  { href: '/', label: 'Access' },
  { href: '/users', label: 'Users' },
];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-6 px-6">
        <span className="text-sm font-semibold">Admin</span>
        <nav className="flex items-center gap-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                pathname === href && 'bg-muted text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {viewer?.email && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {viewer.email}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut();
              router.replace('/sign-in');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
