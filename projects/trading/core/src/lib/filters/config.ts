import { z } from 'zod';

import { EntryFilter } from './entry-filter';
import {
  Cooldown,
  cooldownConfigSchema,
  IndicatorSide,
  indicatorSideConfigSchema,
  MaxEntriesPerDay,
  maxEntriesPerDayConfigSchema,
  TimeWindow,
  timeWindowConfigSchema,
} from './filters';

export const entryFilterConfigSchema = z.discriminatedUnion('type', [
  timeWindowConfigSchema,
  cooldownConfigSchema,
  maxEntriesPerDayConfigSchema,
  indicatorSideConfigSchema,
]);
export type EntryFilterConfig = z.infer<typeof entryFilterConfigSchema>;

export function createEntryFilter(config: EntryFilterConfig): EntryFilter {
  switch (config.type) {
    case 'timeWindow':
      return new TimeWindow(config);
    case 'cooldown':
      return new Cooldown(config);
    case 'maxEntriesPerDay':
      return new MaxEntriesPerDay(config);
    case 'indicatorSide':
      return new IndicatorSide(config);
  }
}

/** Indicator names the filter reads, so the config can check they exist. */
export function entryFilterIndicators(config: EntryFilterConfig): string[] {
  return config.type === 'indicatorSide' ? [config.fast, config.slow] : [];
}
