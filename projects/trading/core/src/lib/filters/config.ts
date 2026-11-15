import { z } from 'zod';

import { EntryFilter } from './entry-filter';
import {
  Cooldown,
  cooldownConfigSchema,
  MaxEntriesPerDay,
  maxEntriesPerDayConfigSchema,
  TimeWindow,
  timeWindowConfigSchema,
} from './filters';

export const entryFilterConfigSchema = z.discriminatedUnion('type', [
  timeWindowConfigSchema,
  cooldownConfigSchema,
  maxEntriesPerDayConfigSchema,
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
  }
}
