import { Injectable, Logger } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import type { PhraseMatch } from '@universe/phrase-matching';
import { ConvexService } from '../common/convex.service';
import { SpeakerProfilesService } from '../feed/speaker-profiles.service';

export interface LeaderboardEntry {
  userId: string;
  count: number;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly convex: ConvexService,
    private readonly speakerProfiles: SpeakerProfilesService,
  ) {}

  getLeaderboard(
    guildId: string,
    phrase: string,
    limit = 10,
  ): Promise<LeaderboardEntry[]> {
    return this.convex.query(api.ruby.counts.leaderboard, {
      guildId,
      phrase,
      limit,
    });
  }

  async recordMatches(
    guildId: string,
    userId: string,
    matches: PhraseMatch[],
  ): Promise<void> {
    if (matches.length === 0) return;
    // Saved for sapphire's leaderboard; a missing profile mustn't lose the counts.
    const speaker = await this.speakerProfiles
      .get(guildId, userId)
      .then(({ displayName, avatarUrl }) => ({ displayName, avatarUrl }))
      .catch((error: Error) => {
        this.logger.warn(`[${guildId}] ${userId}: profile: ${error.message}`);
        return undefined;
      });
    await this.convex.mutation(api.ruby.counts.record, {
      guildId,
      userId,
      matches,
      speaker,
    });
  }
}
