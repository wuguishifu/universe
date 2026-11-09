import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@libs/ui-web';

import { type CaptureSource, commands, type WindowInfo } from '../lib/commands';

const DISPLAY = 'display';

function label(window: WindowInfo) {
  return window.exe ? `${window.title} (${window.exe})` : window.title;
}

/** Picks what's recorded: the main display or one window. */
export function SourcePicker({ source }: { source: CaptureSource }) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);

  const refresh = useCallback(() => {
    commands.listWindows().then(setWindows, () => setWindows([]));
  }, []);
  useEffect(refresh, [refresh]);

  // Keep the recorded window listed even after it's gone from the list (closed, or cloaked).
  const options =
    source.kind === 'window' && !windows.some((w) => w.hwnd === source.hwnd)
      ? [source, ...windows]
      : windows;

  const choose = (value: string) => {
    const window = options.find((w) => String(w.hwnd) === value);
    void commands.setSource(
      window ? { kind: 'window', ...window } : { kind: 'display' },
    );
  };

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="What to record"
        className="bg-background focus-visible:ring-ring h-9 min-w-0 flex-1 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        value={source.kind === 'window' ? String(source.hwnd) : DISPLAY}
        onFocus={refresh}
        onChange={(e) => choose(e.target.value)}
      >
        <option value={DISPLAY}>Entire display</option>
        {options.map((w) => (
          <option key={w.hwnd} value={String(w.hwnd)}>
            {label(w)}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon-lg"
        aria-label="Refresh windows"
        onClick={refresh}
      >
        <RefreshCw aria-hidden />
      </Button>
    </div>
  );
}
