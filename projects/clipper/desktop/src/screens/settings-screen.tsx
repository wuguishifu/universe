import { ArrowLeft, type LucideIcon, Volume2 } from 'lucide-react';
import { useState } from 'react';

import { Button, cn } from '@libs/ui-web';

import type { CaptureStatus } from '../lib/commands';

import { AudioSettings } from './settings/audio-settings';

type Page = 'audio';

const pages: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'audio', label: 'Audio', icon: Volume2 },
];

/** Settings: a page per area, picked from the sidebar. */
export function SettingsScreen({
  status,
  onBack,
}: {
  status: CaptureStatus | undefined;
  onBack: () => void;
}) {
  const [page, setPage] = useState<Page>('audio');

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Settings pages"
        className="bg-card flex w-52 shrink-0 flex-col gap-1 border-r p-3"
      >
        <div className="mb-3 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            title="Back"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden />
          </Button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
        {pages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring flex h-9 items-center gap-2 rounded-md px-3 text-sm focus-visible:ring-2 focus-visible:outline-none',
              page === id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
            onClick={() => setPage(id)}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
          {page === 'audio' && <AudioSettings status={status} />}
        </div>
      </main>
    </div>
  );
}
