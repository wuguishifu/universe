import { Market } from '../types/market';

type Period = 'am' | 'pm';
export type HourWindow = { start: { month: string; day: number; hour12: number; period: Period }; timeSlug: string };

const etPartsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  hour12: true,
});

function getEtStartParts(dateUtc: Date) {
  const parts = etPartsFmt.formatToParts(dateUtc);

  const month = parts.find((p) => p.type === 'month')?.value.toLowerCase();
  const dayStr = parts.find((p) => p.type === 'day')?.value;
  const hourStr = parts.find((p) => p.type === 'hour')?.value;
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value.toLowerCase() as Period | undefined;

  if (!month || !dayStr || !hourStr || !dayPeriod) {
    throw new Error(`Failed to extract ET parts from date: ${dateUtc.toISOString()}`);
  }

  return {
    month,
    day: Number(dayStr),
    hour12: Number(hourStr),
    period: dayPeriod,
  };
}

export function generate1hSlug(asset: string, window: HourWindow) {
  return `${asset}-up-or-down-${window.timeSlug}-et`;
}

export function getCurrentHourWindows() {
  return {
    current: makeHourWindow(new Date()),
    next: makeHourWindow(new Date(Date.now() + 60 * 60 * 1000)),
  };
}

function makeHourWindow(startTimeUtc: Date): HourWindow {
  const start = getEtStartParts(startTimeUtc);
  return { start, timeSlug: `${start.month}-${start.day}-${start.hour12}${start.period}` };
}

export function getTimeRemaining(market: Market, now: Date = new Date()) {
  return market.endDate.getTime() - now.getTime();
}
