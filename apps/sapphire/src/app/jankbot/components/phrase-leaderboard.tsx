'use client';

import type { FunctionReturnType } from 'convex/server';
import { useRef } from 'react';
import { api } from '@universe/hydrogen-kore';
import { cn, Spinner } from '@universe/ui-web';
import { useQuery } from '../../../modules/convex/use-query';
import { Section } from '../../../modules/layout/section';
import { useLeaderboardAccess } from '../lib/use-leaderboard-access';
import { GuildPicker, useSelectedGuild } from './guild-picker';

type Board = FunctionReturnType<typeof api.ruby.leaderboard.forViewer>;

export function PhraseLeaderboard() {
  const { access, error } = useLeaderboardAccess();
  const guilds = access?.guilds ?? [];
  const [guildId, selectGuild] = useSelectedGuild(guilds);

  const { data, error: queryError } = useQuery(
    api.ruby.leaderboard.forViewer,
    access && guildId ? { grant: access.grant, guildId } : 'skip',
  );

  // Swapping in a fresh grant restarts the query; keep showing the last board meanwhile.
  const lastBoard = useRef<{ guildId: string; board: Board } | null>(null);
  if (data && guildId) lastBoard.current = { guildId, board: data };
  const last = lastBoard.current;
  const board = data ?? (last && last.guildId === guildId ? last.board : undefined);

  if (error) {
    return <ErrorSection message={error} />;
  }

  if (!access) {
    return <LoadingSection />;
  }

  return (
    <>
      <GuildPicker guilds={guilds} guildId={guildId} onSelect={selectGuild} />
      {guildId &&
        (queryError && !board ? (
          <ErrorSection message="couldn't load the leaderboard..." />
        ) : !board ? (
          <LoadingSection />
        ) : board.length === 0 ? (
          <Section className="font-vga">
            <p className="text-white/40 text-sm py-2">
              no tracked phrases yet... add one with /words add
            </p>
          </Section>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {board.map((phrase) => (
              <PhraseCard key={phrase.phrase} phrase={phrase} />
            ))}
          </div>
        ))}
    </>
  );
}

function PhraseCard({ phrase }: { phrase: Board[number] }) {
  return (
    <Section className="font-vga flex flex-col gap-1">
      <h3 className="text-sm text-white/60">&quot;{phrase.phrase}&quot;</h3>
      {phrase.entries.length === 0 ? (
        <p className="text-white/40 text-sm py-1">nobody has said it yet...</p>
      ) : (
        <ol className="divide-y divide-white/5">
          {phrase.entries.map((entry, index) => (
            <li key={entry.userId} className="flex items-center gap-3 py-1.5">
              <span
                className={cn('w-5 text-right text-sm text-white/40', {
                  'text-white': index === 0,
                })}
              >
                {index + 1}
              </span>
              {entry.avatarUrl ? (
                <img
                  src={entry.avatarUrl}
                  alt=""
                  className="size-6 rounded-full shrink-0"
                />
              ) : (
                <span className="size-6 rounded-full shrink-0 bg-white/10" />
              )}
              <span className="min-w-0 truncate">
                {/* Counts from before ruby saved profiles have no name until they speak again. */}
                {entry.displayName ?? 'someone'}
              </span>
              <span className="ml-auto tabular-nums">{entry.count}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function LoadingSection() {
  return (
    <Section className="flex items-center justify-center">
      <Spinner className="animate-spin duration-4s" color="#ffffff80" />
    </Section>
  );
}

function ErrorSection({ message }: { message: string }) {
  return (
    <Section className="font-vga">
      <p className="status-down text-sm">{message}</p>
    </Section>
  );
}
