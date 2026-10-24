import { Inject, Injectable } from '@nestjs/common';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-universe-db';
import type { TimedPhraseMatch } from '@libs/phrase-matching';
import { jankbotSchema } from '@platform/postgres-db';

const { recordings } = jankbotSchema;

export interface RecordedUtterance {
  utteranceId: string;
  sessionId: string;
  guildId: string;
  userId: string;
  /** Epoch ms when the user started speaking. */
  startedAt: number;
}

/** Where tracked phrases were said in each utterance's audio, for compiling them per session. */
@Injectable()
export class RecordingsService {
  constructor(@Inject(UNIVERSE_DB) private readonly universeDb: UniverseDb) {}

  /** One row per matched phrase. Safe to retry: an utterance's phrases are only recorded once. */
  async recordMatches(
    { utteranceId, sessionId, guildId, userId, startedAt }: RecordedUtterance,
    matches: TimedPhraseMatch[],
  ): Promise<void> {
    if (matches.length === 0) return;
    await this.universeDb
      .insert(recordings)
      .values(
        matches.map(({ phrase, clips }) => ({
          utteranceId,
          sessionId,
          guildId,
          userId,
          phrase,
          timestamp: new Date(startedAt),
          clips: clips.map(({ startMs, endMs }) => ({
            clipStartMs: startMs,
            clipEndMs: endMs,
          })),
        })),
      )
      .onConflictDoNothing({
        target: [recordings.utteranceId, recordings.phrase],
      });
  }
}
