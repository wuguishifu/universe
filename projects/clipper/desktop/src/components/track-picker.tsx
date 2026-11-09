import { Mic, Monitor, Music, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button, cn, Switch } from '@libs/ui-web';

import {
  type AudioApp,
  type AudioSource,
  type CaptureStatus,
  commands,
  type InputDevice,
} from '../lib/commands';

const ADD = '';
const DEFAULT_DEVICE = '';
/** The quietest level a meter shows. */
const FLOOR_DB = -60;

/** Each track's recent peak, polled ten times a second. */
function useLevels() {
  const [levels, setLevels] = useState<number[]>([]);
  useEffect(() => {
    const timer = setInterval(() => {
      commands.getLevels().then(setLevels, () => setLevels([]));
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return levels;
}

/** A peak meter from -60 dBFS to 0. */
function Meter({ peak, label }: { peak: number | undefined; label: string }) {
  const db = peak && peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const shown = Math.max(FLOOR_DB, Math.min(0, db));
  const fill = ((shown - FLOOR_DB) / -FLOOR_DB) * 100;
  return (
    <div
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={db === -Infinity ? 'silent' : `${Math.round(db)} dB`}
      title={db === -Infinity ? 'Silent' : `${Math.round(db)} dB`}
      className="bg-muted h-1.5 w-20 shrink-0 overflow-hidden rounded-full"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-75',
          db > -3 ? 'bg-warning' : 'bg-good',
        )}
        style={{ width: `${fill}%` }}
      />
    </div>
  );
}

function trackName(track: AudioSource) {
  return track.kind === 'desktop'
    ? 'Desktop'
    : track.kind === 'microphone'
      ? 'Microphone'
      : track.name;
}

function TrackRow({
  track,
  peak,
  detail,
  onRemove,
}: {
  track: AudioSource;
  peak: number | undefined;
  detail?: string;
  onRemove?: () => void;
}) {
  const Icon =
    track.kind === 'desktop'
      ? Monitor
      : track.kind === 'microphone'
        ? Mic
        : Music;
  const name = trackName(track);
  return (
    <li className="flex h-7 items-center gap-2">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
      {detail && (
        <span className="text-muted-foreground shrink-0 text-xs">{detail}</span>
      )}
      <span className="ml-auto" />
      <Meter peak={peak} label={name} />
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      ) : (
        <span className="size-7 shrink-0" />
      )}
    </li>
  );
}

/**
 * The audio tracks, each with a level meter: Desktop (always), the recorded window's app
 * (automatically), apps added here, and the microphone. Saved clips add a mix of Desktop and the
 * microphone first.
 */
export function TrackPicker({ status }: { status: CaptureStatus }) {
  const { tracks, trackSettings: settings, source } = status;
  const [apps, setApps] = useState<AudioApp[]>([]);
  const levels = useLevels();

  const refresh = useCallback(() => {
    commands.listAudioApps().then(setApps, () => setApps([]));
  }, []);
  useEffect(refresh, [refresh]);

  const windowPid = source.kind === 'window' ? source.pid : undefined;
  const addable = apps.filter(
    (a) => a.pid !== windowPid && !settings.apps.some((s) => s.pid === a.pid),
  );
  const micIndex = tracks.findIndex((t) => t.kind === 'microphone');
  const [microphones, setMicrophones] = useState<InputDevice[]>([]);
  const refreshMicrophones = useCallback(() => {
    commands.listMicrophones().then(setMicrophones, () => setMicrophones([]));
  }, []);
  useEffect(refreshMicrophones, [refreshMicrophones]);
  const defaultMic = microphones.find((m) => m.isDefault);

  const update = (next: Partial<typeof settings>) =>
    void commands.setTracks({ ...settings, ...next });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Audio tracks</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {tracks.map((track, i) => {
          const peak = levels[i];
          if (track.kind === 'microphone') return null;
          if (track.kind === 'app' && track.pid === windowPid) {
            return (
              <TrackRow
                key={`app-${track.pid}`}
                track={track}
                peak={peak}
                detail="recorded window"
              />
            );
          }
          if (track.kind === 'app') {
            return (
              <TrackRow
                key={`app-${track.pid}`}
                track={track}
                peak={peak}
                onRemove={() =>
                  update({
                    apps: settings.apps.filter((a) => a.pid !== track.pid),
                  })
                }
              />
            );
          }
          return (
            <TrackRow
              key={track.kind}
              track={track}
              peak={peak}
              detail="everything"
            />
          );
        })}
      </ul>

      <div className="flex h-7 items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={settings.microphone}
            onCheckedChange={(microphone) => update({ microphone })}
          />
          Microphone
        </label>
        {micIndex >= 0 && (
          <>
            <span className="ml-auto" />
            <Meter peak={levels[micIndex]} label="Microphone" />
            <span className="size-7 shrink-0" />
          </>
        )}
      </div>

      {settings.microphone && (
        <select
          aria-label="Microphone device"
          className="bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          value={settings.microphoneDevice ?? DEFAULT_DEVICE}
          onFocus={refreshMicrophones}
          onChange={(e) => update({ microphoneDevice: e.target.value || null })}
        >
          <option value={DEFAULT_DEVICE}>
            Windows default{defaultMic ? ` (${defaultMic.name})` : ''}
          </option>
          {microphones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {settings.microphoneDevice &&
            !microphones.some((m) => m.id === settings.microphoneDevice) && (
              <option value={settings.microphoneDevice}>
                Unplugged device
              </option>
            )}
        </select>
      )}

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
