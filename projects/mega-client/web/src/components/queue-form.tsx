import { ClipboardPaste } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, Input } from '@libs/ui-web';
import { isMegaLink } from '@projects/mega-client-contracts';

import { api, expect } from '../lib/api';
import { useApiMutation } from '../lib/use-api-mutation';

/** Reading the clipboard needs a secure context: HTTPS, or localhost. Over plain HTTP, no button. */
const canPaste = () =>
  window.isSecureContext && typeof navigator.clipboard?.readText === 'function';

export function QueueForm() {
  const [url, setUrl] = useState('');
  const trimmed = url.trim();
  const valid = isMegaLink(trimmed);

  const queue = useApiMutation(
    (link: string) => expect(api.transfers.queue({ body: { url: link } }), 200),
    {
      onSuccess: (link) => {
        // The next link may already be in there.
        setUrl((current) => (current.trim() === link ? '' : current));
        toast.success('Queued');
      },
    },
  );

  const paste = async () => {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      toast.error("Couldn't read the clipboard");
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) queue.mutate(trimmed);
      }}
    >
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://mega.nz/file/…"
          aria-label="MEGA link"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          // 16px keeps iOS Safari from zooming in on focus.
          className="h-11 text-base"
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
      {trimmed && !valid && (
        <p className="text-xs text-critical">That isn't a MEGA link.</p>
      )}
      <Button
        type="submit"
        className="h-11"
        disabled={!valid || queue.isPending}
      >
        {queue.isPending ? 'Queueing…' : 'Download'}
      </Button>
    </form>
  );
}
