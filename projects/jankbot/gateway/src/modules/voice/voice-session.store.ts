import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '@libs/nest-common';
import { voiceBotId } from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';
import { GATEWAY_REDIS } from '../../redis/redis-keys';

/**
 * Remembers which voice channels this gateway's bot was asked to join, so a restarted gateway can
 * rejoin them. Entries are removed only when the bot is told to leave or loses the channel, never
 * on shutdown.
 */
@Injectable()
export class VoiceSessionStore {
  private readonly botId: string;

  constructor(
    private readonly cache: RedisCacheService,
    environmentService: EnvironmentService,
  ) {
    this.botId = voiceBotId(environmentService.environment.name);
  }

  async list(): Promise<{ guildId: string; channelId: string }[]> {
    const sessions = await this.cache.hashGetAll({
      key: GATEWAY_REDIS.voiceSessions,
      id: this.botId,
    });
    return [...sessions].map(([guildId, channelId]) => ({
      guildId,
      channelId,
    }));
  }

  async save(guildId: string, channelId: string): Promise<void> {
    await this.cache.hashSet({
      key: GATEWAY_REDIS.voiceSessions,
      id: this.botId,
      field: guildId,
      value: channelId,
    });
  }

  async remove(guildId: string): Promise<void> {
    await this.cache.hashDelete({
      key: GATEWAY_REDIS.voiceSessions,
      id: this.botId,
      field: guildId,
    });
  }
}
