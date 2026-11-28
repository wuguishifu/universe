import { ClipboardPaste } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, Textarea } from '@libs/web-ui';
import { parseMegaLinks } from '@projects/mega-client-contracts';

import { api, expect } from '../lib/api';
import { useApiMutation } from '../lib/use-api-mutation';

/** Reading the clipboard needs a secure context: HTTPS, or localhost. Over plain HTTP, no button. */
const canPaste = () =>
  window.isSecureContext && typeof navigator.clipboard?.readText === 'function';

export function QueueForm() {
  const [text, setText] = useState('');
  const links = parseMegaLinks(text);

  const queue = useApiMutation(
    ({ urls }: { text: string; urls: string[] }) =>
      expect(api.transfers.queue({ body: { urls } }), 200),
    {
      onSuccess: ({ text: queued, urls }) => {
        // More links may already be in there.
        setText((current) => (current === queued ? '' : current));
        toast.success(urls.length === 1 ? 'Queued' : `Queued ${urls.length}`);
      },
    },
  );

  const submit = () => {
    if (links.length > 0 && !queue.isPending) {
      queue.mutate({ text, urls: links });
    }
  };

  const paste = async () => {
    try {
      const pasted = (await navigator.clipboard.readText()).trim();
      setText((current) =>
        current.trim() ? `${current.trimEnd()}\n${pasted}` : pasted,
      );
    } catch {
      toast.error("Couldn't read the clipboard");
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Textarea
          rows={3}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://mega.nz/file/…, one or more"
          aria-label="MEGA links"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          // 16px keeps iOS Safari from zooming in on focus.
          className="text-base"
        />
        {canPaste() && (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={paste}
          >
            <ClipboardPaste className="h-4 w-4" />
            <span className="ml-2">Paste</span>
          </Button>
        )}
      </div>
      {text.trim() && links.length === 0 && (
        <p className="text-xs text-critical">There's no MEGA link in that.</p>
      )}
      <Button
        type="submit"
        className="h-11"
        disabled={links.length === 0 || queue.isPending}
      >
        {queue.isPending
          ? 'Queueing…'
          : links.length > 1
            ? `Download ${links.length}`
            : 'Download'}
      </Button>
    </form>
  );
}
