import {
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

export const jankbotSchema = {
  recordings,
};
