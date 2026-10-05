import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '@libs/nest-common';
import { JANKBOT_REDIS, voiceBotId } from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import { DiscordRestService } from '../discord/discord-rest.service';

export type VoiceBotStatus = { name: string } & (
  | { state: 'offline' }
  | { state: 'not-in-guild'; userId: string }
  | { state: 'free'; userId: string }
  | { state: 'in-channel'; userId: string; channelId: string }
);

/**
 * The voice bots in VOICE_BOTS and where each one is. Everything is looked up when asked (the
 * heartbeat in Redis, guild membership and voice state from Discord), so nothing can go stale.
 */
@Injectable()
export class VoiceBotsService {
  /** Display names, in preference order. */
  readonly names: readonly string[];

  constructor(
    private readonly cache: RedisCacheService,
    private readonly discord: DiscordRestService,
    environmentService: EnvironmentService,
  ) {
    this.names = environmentService.environment.voiceBots;
  }

  /** The configured name for `name`, ignoring case; undefined if there's no such bot. */
  find(name: string): string | undefined {
    const id = voiceBotId(name);
    return this.names.find((candidate) => voiceBotId(candidate) === id);
  }

  /** Every bot's status in the guild, in VOICE_BOTS order. */
  statuses(guildId: string): Promise<VoiceBotStatus[]> {
    return Promise.all(this.names.map((name) => this.status(name, guildId)));
  }

  async status(name: string, guildId: string): Promise<VoiceBotStatus> {
    const heartbeat = await this.cache.get({
      key: JANKBOT_REDIS.voiceBots,
      id: voiceBotId(name),
    });
    if (!heartbeat) return { name, state: 'offline' };

    const { userId } = heartbeat;
    if (!(await this.discord.isGuildMember(guildId, userId))) {
      return { name, state: 'not-in-guild', userId };
    }
    const channelId = await this.discord.getVoiceChannelId(guildId, userId);
    return channelId
      ? { name, state: 'in-channel', userId, channelId }
      : { name, state: 'free', userId };
  }
}
