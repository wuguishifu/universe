import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { Client } from 'discord.js';
import { Once } from 'necord';
import { RedisCacheService } from '@libs/nest-common';
import {
  JANKBOT_REDIS,
  VOICE_BOT_HEARTBEAT_INTERVAL_MS,
  VOICE_BOT_HEARTBEAT_TTL_SECONDS,
  voiceBotId,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../config/environment';

/**
 * Tells core this voice bot is online and which Discord user it is, so core can map the names in
 * VOICE_BOTS to bots and send them voice commands.
 */
@Injectable()
export class VoiceBotHeartbeatService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VoiceBotHeartbeatService.name);
  private readonly name: string;
  private readonly botId: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: Client,
    private readonly cache: RedisCacheService,
    environmentService: EnvironmentService,
  ) {
    this.name = environmentService.environment.name;
    this.botId = voiceBotId(this.name);
  }

  @Once('clientReady')
  async start() {
    await this.beat();
    this.timer = setInterval(
      () => void this.beat(),
      VOICE_BOT_HEARTBEAT_INTERVAL_MS,
    );
  }

  async beforeApplicationShutdown() {
    clearInterval(this.timer);
    // So core stops picking this bot right away instead of after the TTL.
    try {
      await this.cache.delete({ key: JANKBOT_REDIS.voiceBots, id: this.botId });
    } catch (error) {
      this.logger.warn('Failed to clear heartbeat', error);
    }
  }

  private async beat() {
    const userId = this.client.user?.id;
    if (!userId) return;
    try {
      const current = await this.cache.get({
        key: JANKBOT_REDIS.voiceBots,
        id: this.botId,
      });
      if (current && current.userId !== userId) {
        this.logger.error(
          `Another gateway (bot ${current.userId}) is also named "${current.name}"; NAME must be unique`,
        );
      }
      await this.cache.set({
        key: JANKBOT_REDIS.voiceBots,
        id: this.botId,
        value: { name: this.name, userId },
        ttlSeconds: VOICE_BOT_HEARTBEAT_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn('Heartbeat failed', error);
    }
  }
}
