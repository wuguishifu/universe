import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    name: text('name').notNull(),
    source: text('source').notNull(),
    properties: jsonb('properties').notNull(),
  },
  (table) => [
    index('events_name_timestamp_idx').on(table.name, table.timestamp),
    index('events_timestamp_idx').on(table.timestamp),
  ],
);

export const schema = {
  events,
};
