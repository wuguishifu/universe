import {
  type KeyboardEvent,
  type PointerEvent,
  useMemo,
  useState,
} from 'react';

import {
  type DisplayUnit,
  type HistoryPoint,
  Mode,
  modeLabels,
} from '@projects/thermo-automation-contracts';

import { formatHouseTime } from '../lib/house-time';
import { formatTemperature, toDisplay } from '../lib/temperature';

const WIDTH = 600;
const HEIGHT = 120;
const PAD_Y = 8;
const WINDOW_MS = 24 * 3_600_000;
/** Readings further apart than this (a few missed ticks) break the line instead of joining it. */
const GAP_MS = 12 * 60_000;

type Point = HistoryPoint & { time: number };

/** Runs of consecutive points, split at gaps and wherever `keep` is false. */
function segments(points: Point[], keep: (point: Point) => boolean) {
  const runs: Point[][] = [];
  let run: Point[] = [];
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (!keep(point) || (previous && point.time - previous.time > GAP_MS)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (keep(point)) run.push(point);
  });
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Indoor temperature over the last 24 hours. The shaded band is the thermostat's setpoints while
 * it was running AUTO, so you can see the automations at work.
 */
export function Sparkline({
  points: history,
  unit,
  timeZone,
  now,
}: {
  points: HistoryPoint[];
  unit: DisplayUnit;
  timeZone: string;
  now: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const chart = useMemo(() => {
    const points = history.map((point) => ({
      ...point,
      time: new Date(point.recordedAt).getTime(),
    }));
    if (points.length === 0) return null;

    const start = now - WINDOW_MS;
    const temperatures = points.map((point) => point.indoorTemperatureC);
    const lowest = Math.min(...temperatures);
    const highest = Math.max(...temperatures);
    // Setpoints only widen the scale when they're near the line: an unbounded side is parked at
    // the thermostat's limit, which would flatten everything else.
    const nearby = points
      .filter((point) => point.mode === Mode.Auto)
      .flatMap((point) => [point.heatSetpointC, point.coolSetpointC])
      .filter((value) => value >= lowest - 2 && value <= highest + 2);
    const low = toDisplay(Math.min(lowest, ...nearby), unit) - 1;
    const high = toDisplay(Math.max(highest, ...nearby), unit) + 1;

    const x = (time: number) => ((time - start) / WINDOW_MS) * WIDTH;
    const y = (celsius: number) => {
      const value = Math.min(high, Math.max(low, toDisplay(celsius, unit)));
      return PAD_Y + (1 - (value - low) / (high - low)) * (HEIGHT - 2 * PAD_Y);
    };

    const lines = segments(points, () => true).map((run) =>
      run
        .map(
          (point, i) =>
            `${i ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.indoorTemperatureC).toFixed(1)}`,
        )
        .join(''),
    );
    const bands = segments(points, ({ mode }) => mode === Mode.Auto).map(
      (run) =>
        [
          ...run.map((p) => `${x(p.time)},${y(p.coolSetpointC)}`),
          ...[...run]
            .reverse()
            .map((p) => `${x(p.time)},${y(p.heatSetpointC)}`),
        ].join(' '),
    );

    return { points, x, y, lines, bands, start, lowest, highest };
  }, [history, unit, now]);

  if (!chart) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No readings in the last 24 hours yet
      </div>
    );
  }

  const { points, x, y, lines, bands, lowest, highest } = chart;
  const active = hovered === null ? null : points[hovered];

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time =
      chart.start + ((event.clientX - rect.left) / rect.width) * WINDOW_MS;
    let best = 0;
    points.forEach((point, i) => {
      const current = points[best];
      if (
        current &&
        Math.abs(point.time - time) < Math.abs(current.time - time)
      ) {
        best = i;
      }
    });
    return best;
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step =
      event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    setHovered((current) =>
      Math.min(
        points.length - 1,
        Math.max(0, (current ?? points.length) + step),
      ),
    );
  };

  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    first && last
      ? `Indoor temperature over the last 24 hours, from ${formatTemperature(first.indoorTemperatureC, unit)} to ${formatTemperature(last.indoorTemperatureC, unit)}.`
      : '';

  return (
    <figure className="grid grid-cols-1 gap-1.5">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-[120px] w-full touch-none overflow-visible rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={(event) => setHovered(nearest(event))}
          onPointerLeave={() => setHovered(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setHovered(null)}
        >
          {bands.map((band, i) => (
            <polygon key={i} points={band} className="fill-primary/15" />
          ))}
          {lines.map((line, i) => (
            <path
              key={i}
              d={line}
              fill="none"
              className="stroke-primary"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {active && (
            <line
              x1={x(active.time)}
              x2={x(active.time)}
              y1={0}
              y2={HEIGHT}
              className="stroke-muted-foreground/60"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Dots and labels are HTML so the stretched SVG doesn't distort them. */}
        {active && (
          <>
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
              style={{
                left: `${(x(active.time) / WIDTH) * 100}%`,
                top: `${(y(active.indoorTemperatureC) / HEIGHT) * 100}%`,
              }}
            />
            <div
              className="pointer-events-none absolute top-0 z-10 w-max rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              style={{
                left: `${(x(active.time) / WIDTH) * 100}%`,
                transform: `translate(${x(active.time) > WIDTH / 2 ? '-100%' : '0'}, calc(-100% - 4px))`,
              }}
            >
              <div className="text-sm font-semibold tabular-nums">
                {formatTemperature(active.indoorTemperatureC, unit)}
              </div>
              <div className="text-muted-foreground">
                {formatHouseTime(active.recordedAt, timeZone, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' · '}
                {modeLabels[active.mode] ?? `Mode ${active.mode}`}
                {active.mode === Mode.Auto &&
                  ` ${formatTemperature(active.heatSetpointC, unit, { withUnit: false })}–${formatTemperature(active.coolSetpointC, unit)}`}
              </div>
            </div>
          </>
        )}
      </div>
      <figcaption className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>24h ago</span>
        <span>
          Indoor {formatTemperature(lowest, unit, { withUnit: false })}–
          {formatTemperature(highest, unit)}
          <span aria-hidden> · </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-primary/15" />
            AUTO setpoints
          </span>
        </span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}
