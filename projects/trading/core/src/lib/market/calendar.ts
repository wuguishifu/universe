import { parseClockTime } from './ny-time';

/** Open and close of a session, in minutes after New York midnight. */
export type SessionHours = { open: number; close: number };

export const REGULAR_HOURS: SessionHours = { open: 570, close: 960 }; // 09:30–16:00
export const EXTENDED_HOURS: SessionHours = { open: 240, close: 1200 }; // 04:00–20:00

export interface MarketCalendar {
  /** Regular-session hours for a New York date, or null when the market is closed. */
  regularHours(date: string): SessionHours | null;
}

/** Every weekday is a full session. Knows nothing about holidays or early closes. */
export const weekdayCalendar: MarketCalendar = {
  regularHours(date) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6 ? null : REGULAR_HOURS;
  },
};

/** One trading day, in the shape Alpaca's `/v2/calendar` returns. */
export type CalendarDay = { date: string; open: string; close: string };

/** A calendar from a list of trading days. Dates not in the list are treated as closed. */
export function calendarFromDays(days: readonly CalendarDay[]): MarketCalendar {
  const byDate = new Map<string, SessionHours>(
    days.map((day) => [
      day.date,
      { open: parseClockTime(day.open), close: parseClockTime(day.close) },
    ]),
  );
  return { regularHours: (date) => byDate.get(date) ?? null };
}
