import { CircleDot, CircleOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type CaptureStatus, commands } from './lib/commands';

export function App() {
  const [status, setStatus] = useState<CaptureStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    commands.getStatus().then(setStatus, (e: unknown) => setError(String(e)));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Clipper</h1>
        <p className="text-muted-foreground text-sm">
          Keeps the last few minutes of gameplay so you can save them.
        </p>
      </header>

      <section className="bg-card rounded-lg border p-4">
        {error ? (
          <p className="text-critical text-sm">{error}</p>
        ) : !status ? (
          <p className="text-muted-foreground text-sm">Connecting…</p>
        ) : (
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
            <dt className="text-muted-foreground">Keeps</dt>
            <dd>{status.bufferSeconds} seconds</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{status.version}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
