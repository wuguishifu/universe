import { Injectable } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import type { PhraseMatch } from '@universe/phrase-matching';
import { ConvexService } from '../common/convex.service';

export interface LeaderboardEntry {
  userId: string;
  count: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly convex: ConvexService) {}

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
    await this.convex.mutation(api.ruby.counts.record, {
      guildId,
      userId,
      matches,
    });
  }
}
