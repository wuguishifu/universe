import { CircleDot, CircleOff, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@libs/ui-web';

import { SourcePicker } from './components/source-picker';
import {
  type CaptureStatus,
  type ClipEvent,
  commands,
  onClip,
} from './lib/commands';

function formatSeconds(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function App() {
  const [status, setStatus] = useState<CaptureStatus>();
  const [error, setError] = useState<string>();
  const [clips, setClips] = useState<ClipEvent[]>([]);

  useEffect(() => {
    const poll = () =>
      commands.getStatus().then(
        (s) => {
          setStatus(s);
          setError(undefined);
        },
        (e: unknown) => setError(String(e)),
      );
    poll();
    const timer = setInterval(poll, 1000);
    const stop = onClip((event) => setClips((c) => [event, ...c].slice(0, 20)));
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Clipper</h1>
        <p className="text-muted-foreground text-sm">
          Keeps the last few minutes of gameplay so you can save them.
        </p>
      </header>

      <section className="bg-card flex flex-col gap-4 rounded-lg border p-4">
        {error ? (
          <p className="text-critical text-sm">{error}</p>
        ) : !status ? (
          <p className="text-muted-foreground text-sm">Connecting…</p>
        ) : (
          <>
            <SourcePicker source={status.source} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Replay buffer</dt>
              <dd className="flex items-center gap-2">
                {status.recording ? (
                  <CircleDot className="text-good size-4" aria-hidden />
                ) : (
                  <CircleOff
                    className="text-muted-foreground size-4"
                    aria-hidden
                  />
                )}
                {status.recording ? 'Recording' : 'Not recording'}
              </dd>
              <dt className="text-muted-foreground">Clip length</dt>
              <dd>
                {formatSeconds(status.bufferedSeconds)} of{' '}
                {formatSeconds(status.bufferSeconds)}
              </dd>
              <dt className="text-muted-foreground">Saves to</dt>
              <dd className="break-all">{status.clipsDir}</dd>
            </dl>
            {status.lastError && (
              <p className="text-critical text-sm break-words">
                {status.lastError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void commands.saveClip()}
                disabled={!status.recording}
              >
                <Scissors aria-hidden />
                Save clip
              </Button>
              <span className="text-muted-foreground text-sm">
                or press <kbd className="font-mono">{status.shortcut}</kbd> in
                game
              </span>
            </div>
          </>
        )}
      </section>

      {clips.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Clips this session</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {clips.map((clip, i) => (
              <li
                key={i}
                className={
                  clip.error ? 'text-critical break-words' : 'break-all'
                }
              >
                {clip.path ?? clip.error}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
