'use client';

import { FormEvent, useActionState, useState } from 'react';
import { Spinner } from '@universe/ui-web';
import { ConvertFormState, requestConversion } from '../actions';
import { extractYoutubeVideoId } from '../lib/youtube';

export function ConvertForm() {
  const [state, formAction, isPending] = useActionState<
    ConvertFormState,
    FormData
  >(requestConversion, null);
  const [clientError, setClientError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const input = new FormData(event.currentTarget).get('url');
    if (typeof input !== 'string' || !extractYoutubeVideoId(input)) {
      event.preventDefault();
      setClientError('enter a valid youtube watch link');
      return;
    }
    setClientError(null);
  };

  const error = clientError ?? state?.error;

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="font-vga flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <input
          name="url"
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent rounded-sm px-3 py-2 placeholder:text-white/30 focus:border-highlight/40 outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 rounded-lg hover:bg-gray-400/10 transition-all duration-150 disabled:opacity-50 flex items-center gap-2"
        >
          {isPending && <Spinner />}
          convert
        </button>
      </div>
      {error && <p className="status-down text-sm">{error}</p>}
    </form>
  );
}
