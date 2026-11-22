'use client';

import { useMutation } from 'convex/react';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';

import { api } from '@platform/convex-contracts';

import { errorMessage } from './format';
import type { PartyPlayer } from './types';

/** "Playing as Bo · switch", where tapping the name renames you in place. */
export function MyName({
  me,
  onSwitch,
}: {
  me: PartyPlayer;
  onSwitch: () => void;
}) {
  const rename = useMutation(api.game.players.rename);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  const save = async (name: string) => {
    if (name.trim() === me.name) return cancel();
    setError(null);
    setSaving(true);
    try {
      await rename({ playerId: me._id, name });
      setDraft(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (draft === null) {
    return (
      <p className="text-sm opacity-80">
        Playing as{' '}
        <button
          type="button"
          onClick={() => setDraft(me.name)}
          className="inline-flex items-center gap-1 font-semibold underline decoration-dotted underline-offset-2"
          aria-label={`Playing as ${me.name}, rename`}
        >
          {me.name}
          <PencilIcon className="size-3" />
        </button>
        {' · '}
        <button
          type="button"
          onClick={onSwitch}
          className="underline underline-offset-2"
        >
          switch
        </button>
      </p>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) void save(draft);
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && cancel()}
          aria-label="Your name"
          autoFocus
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-md border border-white/30 bg-white/15 px-2 text-sm font-semibold outline-none placeholder:text-white/50 focus:border-white/70"
        />
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="h-8 shrink-0 rounded-md bg-white px-2.5 text-sm font-semibold text-accent disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="h-8 shrink-0 px-1.5 text-sm underline underline-offset-2 opacity-80"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium">
          {error}
        </p>
      )}
    </form>
  );
}
