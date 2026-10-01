import { SignInButton, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@universe/ui-web';
import { Section } from '../../../modules/layout/section';

const PAGES = [
  { href: '/jankbot', label: 'transcripts' },
  { href: '/jankbot/leaderboard', label: 'leaderboard' },
] as const;

/** Header, page switcher, and sign-in gate shared by the jankbot pages. */
export async function JankbotShell({
  current,
  children,
}: {
  current: (typeof PAGES)[number]['href'];
  children: ReactNode;
}) {
  const { userId } = await auth();

  return (
    <main className="flex flex-col gap-2">
      <Section className="flex items-center gap-4">
        <h2>jankbot</h2>
        <nav className="font-vga flex gap-3 text-sm">
          {PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className={cn(
                'transition-all duration-150',
                page.href === current
                  ? 'text-white'
                  : 'text-white/40 hover:text-white/80',
              )}
            >
              {page.label}
            </Link>
          ))}
        </nav>
        {userId && (
          <div className="ml-auto flex">
            <UserButton />
          </div>
        )}
      </Section>
      {userId ? (
        children
      ) : (
        <Section className="font-vga flex flex-col items-start gap-2">
          <SignInButton mode="modal">
            <button className="px-4 py-2 border border-gray-400/20 rounded-sm hover:bg-gray-400/10 transition-all duration-150">
              sign in with discord
            </button>
          </SignInButton>
        </Section>
      )}
    </main>
  );
}
