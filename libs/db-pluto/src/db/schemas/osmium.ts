import {
  index,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const osmiumPgSchema = pgSchema('osmium');

export const events = osmiumPgSchema.table(
  'events',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').notNull(),
    source: text('source').notNull(),
    metadata: jsonb('metadata').notNull(),
  },
  (table) => [
    index('osmium_events_name_created_at_idx').on(table.name, table.createdAt),
  ],
);

export const osmiumSchema = {
  events,
};
