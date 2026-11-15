// US equity and options sessions run on New York time, so every time rule is evaluated there.

export const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type NyTime = {
  /** Calendar date in New York, `YYYY-MM-DD`. */
  date: string;
  /** Minutes since New York midnight, seconds included as a fraction (09:30:30 → 570.5). */
  minute: number;
};

// Intl formatting is slow next to the rest of a backtest, so cache the last UTC hour seen. New York's
// UTC offset is always a whole number of hours, so one UTC hour never spans two New York hours.
let cachedHour = Number.NaN;
let cachedDate = '';
let cachedBaseMinute = 0;

export function nyTime(epochMs: number): NyTime {
  const hour = Math.floor(epochMs / HOUR_MS);
  if (hour !== cachedHour) {
    let year = '';
    let month = '';
    let day = '';
    let baseMinute = 0;
    for (const part of formatter.formatToParts(hour * HOUR_MS)) {
      if (part.type === 'year') year = part.value;
      else if (part.type === 'month') month = part.value;
      else if (part.type === 'day') day = part.value;
      else if (part.type === 'hour') baseMinute += Number(part.value) * 60;
      else if (part.type === 'minute') baseMinute += Number(part.value);
    }
    cachedHour = hour;
    cachedDate = `${year}-${month}-${day}`;
    cachedBaseMinute = baseMinute;
  }
  return {
    date: cachedDate,
    minute: cachedBaseMinute + (epochMs - hour * HOUR_MS) / MINUTE_MS,
  };
}

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** `'09:30'` → 570. */
export function parseClockTime(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Expected a time like 09:30, got "${hhmm}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}
