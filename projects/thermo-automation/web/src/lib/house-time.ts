// Only imports chrono-node, so `nx test thermo-automation-web` can load this with Node's type stripping.
import * as chrono from 'chrono-node/en';

/** "Until tomorrow" with no time means this hour, in the house's timezone. */
const DEFAULT_HOUR = 6;
const TIME_OF_DAY = /morning|afternoon|evening|night|noon|midnight/;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/** Minutes `timeZone` is ahead of UTC at `instant` (negative west of Greenwich). */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const { year, month, day, hour, minute } = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** The instant a wall-clock time in `timeZone` happens. Month is 1-12. */
export function zonedTimeToUtc(
  { year, month, day, hour, minute }: ZonedParts,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Twice, in case the first guess lands on the other side of a DST change.
  let instant = new Date(asUtc);
  for (let i = 0; i < 2; i++) {
    instant = new Date(asUtc - utcOffsetMinutes(instant, timeZone) * 60_000);
  }
  return instant;
}

const UNITS: Record<string, number> = {
  d: 1440,
  day: 1440,
  days: 1440,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
};

/**
 * Shorthand durations: "1h30", "1.5h", "90m", "2h15m", "1d". A trailing bare number is minutes
 * after hours ("1h30"); a bare number alone isn't a duration.
 */
export function parseDurationMinutes(text: string): number | null {
  const compact = text.replace(/\s+/g, '');
  const pattern = /(\d+(?:\.\d+)?)([a-z]*)/gy;
  let total = 0;
  let previousUnit: number | null = null;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(compact))) {
    const [whole, amount = '', unitText = ''] = match;
    let unit = unitText ? UNITS[unitText] : undefined;
    if (unit === undefined && !unitText && previousUnit === 60) unit = 1;
    if (unit === undefined) return null;
    total += Number(amount) * unit;
    previousUnit = unit;
    consumed += whole.length;
  }
  if (consumed === 0 || consumed !== compact.length || total <= 0) return null;
  return total;
}

/**
 * When a pause typed as text ends, or null if it can't be read or isn't in the future.
 * Takes durations ("1h30", "1.5h") or anything chrono-node understands ("tomorrow at 5pm",
 * "friday 8am", "2026-10-18 18:00"), read in the house's timezone. "until" and "for" are optional.
 */
export function parsePauseInput(
  text: string,
  { now, timeZone }: { now: Date; timeZone: string },
): Date | null {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/^(until|till|til|for)\s+/, '');
  if (!input) return null;

  const minutes = parseDurationMinutes(input);
  if (minutes !== null) {
    return new Date(now.getTime() + minutes * 60_000);
  }

  const [result] = chrono.parse(
    input,
    { instant: now, timezone: utcOffsetMinutes(now, timeZone) },
    { forwardDate: true },
  );
  // Reject partial matches like "tomorrow-ish", rather than guessing at what was meant.
  if (!result || result.index !== 0 || result.text.length !== input.length) {
    return null;
  }

  let until = result.start.date();
  // chrono gives a bare day ("tomorrow", "friday") some time of its own choosing. "tonight" and
  // the like imply a time, which is kept.
  if (!result.start.isCertain('hour') && !TIME_OF_DAY.test(input)) {
    until = zonedTimeToUtc(
      { ...zonedParts(until, timeZone), hour: DEFAULT_HOUR, minute: 0 },
      timeZone,
    );
  }

  return until > now ? until : null;
}

/** e.g. "Sat, Oct 18, 5:00 PM", in the house's timezone. */
export function formatHouseTime(
  instant: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(
    new Date(instant),
  );
}
