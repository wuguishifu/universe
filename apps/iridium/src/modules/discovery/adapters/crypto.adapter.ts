import { Logger } from '@nestjs/common';

import { MarketAdapter } from './marketAdapter';
import { Event, eventSchema } from '../../../types/event';

type Period = 'am' | 'pm';
type HourWindow = { start: { month: string; day: number; hour12: number; period: Period }; timeSlug: string };

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

function generate1hSlug(asset: string, window: HourWindow) {
  return `${asset}-up-or-down-${window.timeSlug}-et`;
}

function getCurrentHourWindows() {
  return {
    current: makeHourWindow(new Date()),
    next: makeHourWindow(new Date(Date.now() + 60 * 60 * 1000)),
  };
}

function makeHourWindow(startTimeUtc: Date): HourWindow {
  const start = getEtStartParts(startTimeUtc);
  return { start, timeSlug: `${start.month}-${start.day}-${start.hour12}${start.period}` };
}

const assets = ['bitcoin', 'ethereum', 'solana', 'xrp'] as const;

export class CryptoAdapter extends MarketAdapter {
  protected readonly logger = new Logger(CryptoAdapter.name);

  async fetchMarkets() {
    const { current, next } = getCurrentHourWindows();

    const fetchEvent = async (asset: string, window: HourWindow): Promise<Event | null> => {
      const slug = generate1hSlug(asset, window);
      const response = await this.httpService.get(`/events/slug/${slug}`);
      if (response.status === 200) {
        this.logger.debug(`Fetched market data for ${asset} in window ${window.timeSlug}`);

        const parsed = eventSchema.safeParse(response.data);
        if (!parsed.success) {
          this.logger.warn(`Invalid event data for ${asset} in window ${window.timeSlug}: ${parsed.error.message}`);
          return null;
        }

        return parsed.data;
      }

      this.logger.warn(`Failed to fetch market data for ${asset} in window ${window.timeSlug}`);
      return null;
    };

    const events = await Promise.all(assets.flatMap((asset) => [fetchEvent(asset, current), fetchEvent(asset, next)]));
    return events.flatMap((event) => event?.markets ?? []);
  }
}
