import { z } from 'zod';
import {
  defineRedisKeys,
  redisHash,
  redisLock,
  redisSet,
  redisValue,
} from '@libs/redis-cache';
import { voiceBotHeartbeatSchema } from './voice-bots';

/** Every Redis key jankbot uses outside BullMQ, shared by gateway and core. Voice bot ids come from voiceBotId. */
export const JANKBOT_REDIS = defineRedisKeys('jankbot', {
  /**
   * core's commands whose replies are ephemeral. Discord fixes ephemerality when the gateway
   * defers, so core publishes this on startup and the gateway checks it per command. That keeps
   * core's command definitions out of the gateway's build.
   */
  ephemeralCommands: redisSet('ephemeral-commands', z.string()),
  /** Per voice bot: guildId → channelId of every voice channel that bot should be in. */
  voiceSessions: redisHash('voice-sessions', z.string(), { perId: true }),
  /** Per voice bot: present while its gateway is running (expires VOICE_BOT_HEARTBEAT_TTL_SECONDS after the last beat). */
  voiceBots: redisValue('voice-bots', voiceBotHeartbeatSchema, { perId: true }),
  /**
   * Per `<voice bot>:<guildId>`: held by core while it sends that bot to a channel, so two /joins
   * at once don't pick the same free bot.
   */
  joinClaims: redisLock('join-claims', { perId: true }),
});
