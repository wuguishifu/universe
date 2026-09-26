import { Injectable } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import { ConvexService } from '../common/convex.service';

@Injectable()
export class TrackedWordsService {
  constructor(private readonly convex: ConvexService) {}

  list(guildId: string): Promise<string[]> {
    return this.convex.query(api.ruby.phrases.list, { guildId });
  }

  /**
   * Returns false if an equivalent phrase is already tracked.
   * Throws a ConvexError with a user-facing message if the phrase is invalid or the guild is full.
   */
  async add(guildId: string, phrase: string): Promise<boolean> {
    const { added } = await this.convex.mutation(api.ruby.phrases.add, {
      guildId,
      phrase,
    });
    return added;
  }

  /** Returns false if the phrase was not being tracked. */
  async remove(guildId: string, phrase: string): Promise<boolean> {
    const { removed } = await this.convex.mutation(api.ruby.phrases.remove, {
      guildId,
      phrase,
    });
    return removed;
  }
}
