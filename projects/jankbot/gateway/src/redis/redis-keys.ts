import { z } from 'zod';
import { defineRedisKeys, redisHash } from '@libs/redis-cache';

/**
 * Redis keys only the gateway uses, so they can change without redeploying core. Voice bot ids
 * come from voiceBotId.
 */
export const GATEWAY_REDIS = defineRedisKeys('jankbot-gateway', {
  /** Per voice bot: guildId → channelId of every voice channel that bot should be in. */
  voiceSessions: redisHash('voice-sessions', z.string(), { perId: true }),
});
