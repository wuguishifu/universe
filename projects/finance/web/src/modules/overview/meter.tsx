import { formatPercent } from '../format';

/** How much of a limit is used: a thin bar on a lighter track of the same color. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={formatPercent(value)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
