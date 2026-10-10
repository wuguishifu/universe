import {
  boolean,
  index,
  jsonb,
  pgSchema,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const jankbotPgSchema = pgSchema('jankbot');

export const recordings = jankbotPgSchema.table(
  'recordings',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    /** also used to identify recording in s3 */
    utteranceId: text('utterance_id').notNull(),
    /** configured phrase, not transcribed phrase */
    phrase: text('phrase').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    clips: jsonb('clips')
      .$type<{ clipStartMs: number; clipEndMs: number }[]>()
      .notNull(),
  },
  (table) => [
    index('recordings_session_id_phrase_timestamp_idx').on(
      table.sessionId,
      table.phrase,
      table.timestamp,
    ),
    uniqueIndex('recordings_utterance_id_phrase_idx').on(
      table.utteranceId,
      table.phrase,
    ),
  ],
);

/** Per-user settings, across every server. A user without a row has the defaults. */
export const userPreferences = jankbotPgSchema.table('user_preferences', {
  userId: text('user_id').primaryKey(),
  /** Leaves the user's voice out of compilations (`/optout`). */
  excludeFromCompilations: boolean('exclude_from_compilations')
    .notNull()
    .default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const jankbotSchema = {
  recordings,
  userPreferences,
};
