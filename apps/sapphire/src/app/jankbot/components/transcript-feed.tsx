'use client';

import { useMemo } from 'react';
import type { FeedUtterance } from '@universe/contracts-ruby';
import { Spinner } from '@universe/ui-web';
import { Section } from '../../../modules/layout/section';
import { useFeed } from '../lib/use-feed';
import { GuildPicker, useSelectedGuild } from './guild-picker';

export function TranscriptFeed() {
  const { status, error, guilds, utterances } = useFeed();
  const [guildId, selectGuild] = useSelectedGuild(guilds);

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
      <GuildPicker
        guilds={guilds}
        guildId={guildId}
        status={status}
        onSelect={selectGuild}
      />
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
