'use client';

import { useState } from 'react';
import type { FeedGuild } from '@universe/contracts-ruby';
import { cn, Spinner } from '@universe/ui-web';
import { Section } from '../../../modules/layout/section';
import type { FeedStatus } from '../lib/use-feed';

const SELECTED_GUILD_KEY = 'ruby-feed-guild';

/**
 * The selected server, remembered across visits and shared between jankbot pages. Falls back
 * to the first server if the saved one isn't available (any more).
 */
export function useSelectedGuild(guilds: FeedGuild[]) {
  const [pickedGuildId, setPickedGuildId] = useState(readSavedGuild);
  const guildId = guilds.some((guild) => guild.id === pickedGuildId)
    ? pickedGuildId
    : guilds[0]?.id;

  const select = (id: string) => {
    setPickedGuildId(id);
    saveGuild(id);
  };

  return [guildId, select] as const;
}

export function GuildPicker({
  guilds,
  guildId,
  status,
  onSelect,
}: {
  guilds: FeedGuild[];
  guildId: string | undefined;
  /** Shown as a badge, for pages backed by a ruby socket. */
  status?: FeedStatus;
  onSelect: (guildId: string) => void;
}) {
  return (
    <Section className="font-vga flex flex-wrap items-center gap-2">
      {guilds.length === 0 ? (
        <p className="text-white/40 text-sm">
          ruby isn&apos;t in any of your servers...
        </p>
      ) : (
        guilds.map((guild) => (
          <GuildButton
            key={guild.id}
            guild={guild}
            selected={guild.id === guildId}
            onSelect={() => onSelect(guild.id)}
          />
        ))
      )}
      {status && <StatusBadge status={status} />}
    </Section>
  );
}

function GuildButton({
  guild,
  selected,
  onSelect,
}: {
  guild: FeedGuild;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 px-3 py-1 border rounded-sm transition-all duration-150',
        selected
          ? 'border-white/40 bg-white/10'
          : 'border-gray-400/20 hover:bg-gray-400/10',
      )}
    >
      {guild.iconUrl ? (
        <img src={guild.iconUrl} alt="" className="size-5 rounded-full" />
      ) : (
        <span className="size-5 rounded-full bg-white/10 text-xs flex items-center justify-center">
          {guild.name.charAt(0)}
        </span>
      )}
      {guild.name}
    </button>
  );
}

function StatusBadge({ status }: { status: FeedStatus }) {
  return (
    <span
      className={cn('ml-auto text-sm flex items-center gap-1', {
        'status-ok': status === 'live',
        'status-degraded': status === 'reconnecting',
      })}
    >
      {status === 'reconnecting' && <Spinner />}
      {status.toUpperCase()}
    </span>
  );
}

function readSavedGuild(): string | undefined {
  try {
    return localStorage.getItem(SELECTED_GUILD_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveGuild(guildId: string) {
  try {
    localStorage.setItem(SELECTED_GUILD_KEY, guildId);
  } catch {
    // Remembering the server is only a convenience.
  }
}
