import {
  Gamepad2,
  Headphones,
  type LucideIcon,
  Mic,
  Monitor,
  TriangleAlert,
} from 'lucide-react';

import type { AudioSource, CaptureStatus, TrackState } from '../lib/commands';

import { LevelMeter, useLevels } from './level-meter';

export function trackLabel(track: AudioSource): string {
  switch (track.kind) {
    case 'desktop':
      return 'Desktop audio';
    case 'microphone':
      return 'Microphone';
    case 'app':
      return 'Game audio';
    case 'program':
      return `${track.name} audio`;
  }
}

function trackIcon(track: AudioSource): LucideIcon {
  switch (track.kind) {
    case 'desktop':
      return Monitor;
    case 'microphone':
      return Mic;
    case 'app':
      return Gamepad2;
    case 'program':
      return Headphones;
  }
}

/** Why a track is silent: muted for something expected, a warning badge for a problem. */
export function TrackStateNote({ state }: { state: TrackState | undefined }) {
  if (state?.state === 'waiting') {
    return (
      <span className="text-muted-foreground min-w-0 truncate text-xs">
        {state.reason}
      </span>
    );
  }
  if (state?.state === 'unavailable') {
    return (
      <span
        className="border-warning/40 bg-warning/10 text-warning inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
        title={state.reason}
      >
        <TriangleAlert className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{state.reason}</span>
      </span>
    );
  }
  return null;
}

/** The tracks being recorded, each with its level and, if it's silent, why. */
export function TrackList({
  status,
  onOpenSettings,
}: {
  status: CaptureStatus;
  onOpenSettings: () => void;
}) {
  const levels = useLevels();
  const { tracks, trackStates } = status;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Audio tracks</h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          onClick={onOpenSettings}
        >
          Change in settings
        </button>
      </div>
      {tracks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No audio is recorded: every audio track is switched off.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {tracks.map((track, i) => {
            const Icon = trackIcon(track);
            const label = trackLabel(track);
            return (
              <li
                key={`${track.kind}-${i}`}
                className="flex h-7 items-center gap-2"
              >
                <Icon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                <span className="shrink-0">{label}</span>
                <TrackStateNote state={trackStates[i]} />
                <span className="ml-auto" />
                <LevelMeter peak={levels[i]} label={label} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
