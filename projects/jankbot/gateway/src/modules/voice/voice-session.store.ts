import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** guildId → channelId of every voice channel the bot should be in. */
const SESSIONS_KEY = 'jankbot:voice-sessions';

/**
 * Remembers which voice channels the bot was asked to join, so a restarted gateway can rejoin them.
 * Entries are removed only when the bot is told to leave or loses the channel, never on shutdown.
 */
@Injectable()
export class VoiceSessionStore {
  constructor(private readonly redis: RedisService) {}

  async list(): Promise<{ guildId: string; channelId: string }[]> {
    const sessions = await this.redis.client.hgetall(SESSIONS_KEY);
    return Object.entries(sessions).map(([guildId, channelId]) => ({
      guildId,
      channelId,
    }));
  }

  async save(guildId: string, channelId: string): Promise<void> {
    await this.redis.client.hset(SESSIONS_KEY, guildId, channelId);
  }

  async remove(guildId: string): Promise<void> {
    await this.redis.client.hdel(SESSIONS_KEY, guildId);
  }
}
