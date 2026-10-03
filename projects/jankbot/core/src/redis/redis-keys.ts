import { z } from 'zod';
import { defineRedisKeys, redisLock, redisValue } from '@libs/redis-cache';

/** Redis keys only core uses, so they can change without redeploying the gateway. */
export const CORE_REDIS = defineRedisKeys('jankbot-core', {
  /**
   * Per `<voice bot>:<guildId>`: held while core sends that bot to a channel, so two /joins at
   * once don't pick the same free bot.
   */
  joinClaims: redisLock('join-claims', { perId: true }),
  /**
   * Per guildId: cache of the guild's tracked phrases from convex. A value rather than a set so
   * an empty list is cached too (an empty set doesn't exist in Redis).
   */
  phrases: redisValue('phrases', z.array(z.string()), { perId: true }),
});
