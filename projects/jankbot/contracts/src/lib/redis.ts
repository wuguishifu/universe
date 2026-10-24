import { z } from 'zod';

import { defineRedisKeys, redisSet, redisValue } from '@libs/redis-cache';

import { voiceBotHeartbeatSchema } from './voice-bots';

/**
 * Redis keys that both gateway and core read or write, so changing one means redeploying both.
 * Keys only one app uses live in that app (CORE_REDIS, GATEWAY_REDIS), each in its own namespace.
 * Voice bot ids come from voiceBotId.
 */
export const JANKBOT_REDIS = defineRedisKeys('jankbot-shared', {
  /**
   * core's commands whose replies are ephemeral. Discord fixes ephemerality when the gateway
   * defers, so core publishes this on startup and the gateway checks it per command. That keeps
   * core's command definitions out of the gateway's build.
   */
  ephemeralCommands: redisSet('ephemeral-commands', z.string()),
  /** Per voice bot: present while its gateway is running (expires VOICE_BOT_HEARTBEAT_TTL_SECONDS after the last beat). */
  voiceBots: redisValue('voice-bots', voiceBotHeartbeatSchema, { perId: true }),
});
