import { z } from 'zod';

import { defineRedisKeys, redisHash } from '@libs/redis-cache';

export const voiceSessionSchema = z.object({
  channelId: z.string(),
  /** Kept across gateway restarts and rejoins, so the session lasts until the bot actually leaves. */
  sessionId: z.uuid(),
  /** Epoch ms when the session started. Missing on sessions remembered before it was added. */
  startedAt: z.number().optional(),
});
export type VoiceSession = z.infer<typeof voiceSessionSchema>;

/**
 * Redis keys only the gateway uses, so they can change without redeploying core. Voice bot ids
 * come from voiceBotId.
 */
export const GATEWAY_REDIS = defineRedisKeys('jankbot-gateway', {
  /** Per voice bot: guildId → the voice session of every voice channel that bot should be in. */
  voiceSessions: redisHash('voice-sessions', voiceSessionSchema, {
    perId: true,
  }),
});
