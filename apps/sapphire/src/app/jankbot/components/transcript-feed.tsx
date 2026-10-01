'use client';

import { useMemo, useState } from 'react';
import type { FeedGuild, FeedUtterance } from '@universe/contracts-ruby';
import { cn, Spinner } from '@universe/ui-web';
import { Section } from '../../../modules/layout/section';
import { type FeedStatus, useFeed } from '../lib/use-feed';

const SELECTED_GUILD_KEY = 'ruby-feed-guild';

export function TranscriptFeed() {
  const { status, error, guilds, utterances } = useFeed();
  const [pickedGuildId, setPickedGuildId] = useState(readSavedGuild);

  // Fall back to the first server if the saved one isn't available (any more).
  const guildId = guilds.some((guild) => guild.id === pickedGuildId)
    ? pickedGuildId
    : guilds[0]?.id;

  const visible = useMemo(
    () =>
      utterances
        .filter((utterance) => utterance.guildId === guildId)
        .sort((a, b) => b.startedAt - a.startedAt),
    [utterances, guildId],
  );

  if (error) {
    return (
      <Section className="font-vga">
        <p className="status-down text-sm">{error}</p>
      </Section>
    );
  }

  if (status === 'connecting') {
    return (
      <Section className="flex items-center justify-center">
        <Spinner className="animate-spin duration-4s" color="#ffffff80" />
      </Section>
    );
  }

  return (
    <>
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
              onSelect={() => {
                setPickedGuildId(guild.id);
                saveGuild(guild.id);
              }}
            />
          ))
        )}
        <StatusBadge status={status} />
      </Section>
      {guildId && (
        <Section className="font-vga">
          {visible.length === 0 ? (
            <p className="text-white/40 text-sm py-2">it's quiet in here...</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {visible.map((utterance) => (
                <UtteranceRow key={utterance.id} utterance={utterance} />
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
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

function UtteranceRow({ utterance }: { utterance: FeedUtterance }) {
  const { speaker } = utterance;
  return (
    <li className="flex gap-3 py-2">
      <img
        src={speaker.avatarUrl}
        alt=""
        className="size-8 rounded-full shrink-0 mt-0.5"
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 text-sm">
          <span>{speaker.displayName}</span>
          <span className="text-white/40">
            {formatTime(utterance.startedAt)}
            {utterance.channelName && ` · #${utterance.channelName}`}
          </span>
        </div>
        <p className="text-white/80 wrap-break-word">{utterance.text}</p>
      </div>
    </li>
  );
}

function formatTime(epochMs: number) {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
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
