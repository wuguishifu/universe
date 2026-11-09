import { Mic, Monitor, Music, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button, Switch } from '@libs/ui-web';

import {
  type AudioApp,
  type AudioSource,
  type CaptureStatus,
  commands,
} from '../lib/commands';

const ADD = '';

function TrackRow({
  track,
  detail,
  onRemove,
}: {
  track: AudioSource;
  detail?: string;
  onRemove?: () => void;
}) {
  const Icon =
    track.kind === 'desktop'
      ? Monitor
      : track.kind === 'microphone'
        ? Mic
        : Music;
  const name =
    track.kind === 'desktop'
      ? 'Desktop'
      : track.kind === 'microphone'
        ? 'Microphone'
        : track.name;
  return (
    <li className="flex items-center gap-2">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
      {detail && (
        <span className="text-muted-foreground shrink-0 text-xs">{detail}</span>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      )}
    </li>
  );
}

/**
 * The audio tracks: Desktop (always), the recorded window's app (automatically), apps added
 * here, and the microphone. Saved clips add a mix of Desktop and the microphone first.
 */
export function TrackPicker({ status }: { status: CaptureStatus }) {
  const { tracks, trackSettings: settings, source } = status;
  const [apps, setApps] = useState<AudioApp[]>([]);

  const refresh = useCallback(() => {
    commands.listAudioApps().then(setApps, () => setApps([]));
  }, []);
  useEffect(refresh, [refresh]);

  const windowPid = source.kind === 'window' ? source.pid : undefined;
  const addable = apps.filter(
    (a) => a.pid !== windowPid && !settings.apps.some((s) => s.pid === a.pid),
  );

  const update = (next: Partial<typeof settings>) =>
    void commands.setTracks({ ...settings, ...next });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Audio tracks</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {tracks.map((track) => {
          if (track.kind === 'microphone') return null;
          if (track.kind === 'app' && track.pid === windowPid) {
            return (
              <TrackRow
                key={`app-${track.pid}`}
                track={track}
                detail="recorded window"
              />
            );
          }
          if (track.kind === 'app') {
            return (
              <TrackRow
                key={`app-${track.pid}`}
                track={track}
                onRemove={() =>
                  update({
                    apps: settings.apps.filter((a) => a.pid !== track.pid),
                  })
                }
              />
            );
          }
          return (
            <TrackRow key={track.kind} track={track} detail="everything" />
          );
        })}
      </ul>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={settings.microphone}
          onCheckedChange={(microphone) => update({ microphone })}
        />
        Microphone
      </label>

      <select
        aria-label="Add an app's audio as a track"
        className="bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        value={ADD}
        onFocus={refresh}
        onChange={(e) => {
          const app = addable.find((a) => String(a.pid) === e.target.value);
          if (app) update({ apps: [...settings.apps, app] });
        }}
      >
        <option value={ADD}>
          {addable.length
            ? 'Add an app’s audio…'
            : 'No other apps playing audio'}
        </option>
        {addable.map((a) => (
          <option key={a.pid} value={String(a.pid)}>
            {a.name}
          </option>
        ))}
      </select>

      {status.trackWarnings.map((w) => (
        <p key={w} className="text-warning text-sm">
          {w}
        </p>
      ))}
    </div>
  );
}
