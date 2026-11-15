import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@libs/ui-web';

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
      <Select onValueChange={choose}>
        <SelectTrigger className="w-full" onFocus={refresh} size="default">
          <SelectValue placeholder="Entire display" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={DISPLAY}>Entire display</SelectItem>
            {options.map((w) => (
              <SelectItem key={w.hwnd} value={String(w.hwnd)}>
                {label(w)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        aria-label="Refresh windows"
        onClick={refresh}
      >
        <RefreshCw aria-hidden />
      </Button>
    </div>
  );
}
