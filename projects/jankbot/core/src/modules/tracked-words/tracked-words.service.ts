import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '@libs/nest-common';
import { api } from '@platform/convex-contracts';
import { JANKBOT_REDIS } from '@projects/jankbot-contracts';
import { ConvexService } from '../common/convex.service';

/**
 * Only core changes phrases, and it clears the cache when it does. The TTL catches edits made
 * elsewhere (e.g. the convex dashboard).
 */
const PHRASES_CACHE_TTL_SECONDS = 60 * 60;

@Injectable()
export class TrackedWordsService {
  constructor(
    private readonly convex: ConvexService,
    private readonly cache: RedisCacheService,
  ) {}

  async list(guildId: string): Promise<string[]> {
    const target = { key: JANKBOT_REDIS.phrases, id: guildId };
    const cached = await this.cache.get(target);
    if (cached) return cached;

    const phrases = await this.convex.query(api.ruby.phrases.list, {
      guildId,
    });
    await this.cache.set({
      ...target,
      value: phrases,
      ttlSeconds: PHRASES_CACHE_TTL_SECONDS,
    });
    return phrases;
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
    if (added) await this.invalidate(guildId);
    return added;
  }

  /** Returns false if the phrase was not being tracked. */
  async remove(guildId: string, phrase: string): Promise<boolean> {
    const { removed } = await this.convex.mutation(api.ruby.phrases.remove, {
      guildId,
      phrase,
    });
    if (removed) await this.invalidate(guildId);
    return removed;
  }

  private async invalidate(guildId: string): Promise<void> {
    await this.cache.delete({ key: JANKBOT_REDIS.phrases, id: guildId });
  }
}
