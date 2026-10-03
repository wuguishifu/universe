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
    /**
     * Any top level property in here is indexed, so be mindful of what you're adding.
     * In dashboards/psql, you can then query based on these properties like this:
     * ```sql
     * SELECT *
     * FROM events
     * WHERE properties@> '{"discordUserId": "12345"}'::jsonb;
     * ```
     */
    properties: jsonb('properties').notNull(),
    extra: jsonb('properties').notNull(),
  },
  (table) => [
    index('events_name_timestamp_idx').on(table.name, table.timestamp),
    index('events_timestamp_idx').on(table.timestamp),
    index('events_properties_gin_idx').using('gin', table.properties),
  ],
);

export const schema = {
  events,
};
