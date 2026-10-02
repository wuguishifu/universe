import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '@libs/nest-common';
import { JANKBOT_REDIS } from '@projects/jankbot-contracts';

/**
 * Remembers which voice channels the bot was asked to join, so a restarted gateway can rejoin them.
 * Entries are removed only when the bot is told to leave or loses the channel, never on shutdown.
 */
@Injectable()
export class VoiceSessionStore {
  constructor(private readonly cache: RedisCacheService) {}

  async list(): Promise<{ guildId: string; channelId: string }[]> {
    const sessions = await this.cache.hashGetAll({
      key: JANKBOT_REDIS.voiceSessions,
    });
    return [...sessions].map(([guildId, channelId]) => ({
      guildId,
      channelId,
    }));
  }

  async save(guildId: string, channelId: string): Promise<void> {
    await this.cache.hashSet({
      key: JANKBOT_REDIS.voiceSessions,
      field: guildId,
      value: channelId,
    });
  }

  async remove(guildId: string): Promise<void> {
    await this.cache.hashDelete({
      key: JANKBOT_REDIS.voiceSessions,
      field: guildId,
    });
  }
}
