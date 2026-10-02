import { z } from 'zod';
import { defineRedisKeys, redisHash, redisSet } from '@libs/redis-cache';

/** Every Redis key jankbot uses outside BullMQ, shared by gateway and core. */
export const JANKBOT_REDIS = defineRedisKeys('jankbot', {
  /**
   * core's commands whose replies are ephemeral. Discord fixes ephemerality when the gateway
   * defers, so core publishes this on startup and the gateway checks it per command. That keeps
   * core's command definitions out of the gateway's build.
   */
  ephemeralCommands: redisSet('ephemeral-commands', z.string()),
  /** guildId → channelId of every voice channel the bot should be in. */
  voiceSessions: redisHash('voice-sessions', z.string()),
});
