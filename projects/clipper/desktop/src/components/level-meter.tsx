import { useEffect, useState } from 'react';

import { cn } from '@libs/ui-web';

import { commands } from '../lib/commands';

/** The quietest level a meter shows. */
const FLOOR_DB = -60;

/** Each track's recent peak (0 to 1), in the order of the status's tracks, ten times a second. */
export function useLevels() {
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
export function LevelMeter({
  peak,
  label,
  className,
}: {
  peak: number | undefined;
  label: string;
  className?: string;
}) {
  const db = peak && peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const shown = Math.max(FLOOR_DB, Math.min(0, db));
  const fill = ((shown - FLOOR_DB) / -FLOOR_DB) * 100;
  const text = db === -Infinity ? 'Silent' : `${Math.round(db)} dB`;
  return (
    <div
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={text}
      title={text}
      className={cn(
        'bg-muted h-1.5 w-20 shrink-0 overflow-hidden rounded-full',
        className,
      )}
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
