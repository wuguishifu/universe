import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { Client } from 'discord.js';
import { Once } from 'necord';

import { createBullRootOptions } from '@libs/queue';
import {
  JANKBOT_QUEUE_PREFIX,
  VOICE_COMMANDS,
  type VoiceCommandJobData,
  type VoiceCommandResult,
} from '@projects/jankbot-contracts';

import { EnvironmentService } from '../../config/environment';

import { VoiceSessionService } from './voice-session.service';

/**
 * Runs the joins and leaves core sends to this voice bot. The queue is named after this bot (core
 * picks the bot), so it's a plain BullMQ worker rather than a static @Processor.
 */
@Injectable()
export class VoiceCommandWorker implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VoiceCommandWorker.name);
  private worker: Worker<VoiceCommandJobData, VoiceCommandResult> | undefined;

  constructor(
    private readonly client: Client,
    private readonly voiceSessions: VoiceSessionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  /** Not before: joining needs the client's guild and channel cache. */
  @Once('clientReady')
  start() {
    const { name, redisUrl } = this.environmentService.environment;
    this.worker = new Worker(
      VOICE_COMMANDS.queueName(name),
      (job) => this.process(job),
      {
        ...createBullRootOptions(redisUrl, JANKBOT_QUEUE_PREFIX),
        // One at a time, so a join and a leave for the same guild can't interleave.
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `Voice command ${job?.data.command.action ?? ''} failed`,
        error,
      ),
    );
    this.worker.on('error', (error) =>
      this.logger.error('Voice command worker error', error),
    );
  }

  async beforeApplicationShutdown() {
    await this.worker?.close();
  }

  private async process(
    job: Job<VoiceCommandJobData, VoiceCommandResult>,
  ): Promise<VoiceCommandResult> {
    const { expiresAt, guildId, command } = VOICE_COMMANDS.jobSchema.parse(
      job.data,
    );
    if (Date.now() > expiresAt) return { status: 'expired' };

    if (command.action === 'leave') {
      const left = await this.voiceSessions.leave(guildId);
      return { status: left ? 'left' : 'not-connected' };
    }

    const channel = await this.client.channels
      .fetch(command.channelId)
      .catch(() => null);
    if (
      !channel?.isVoiceBased() ||
      channel.guild.id !== guildId ||
      !channel.joinable
    ) {
      return { status: 'channel-unavailable' };
    }
    try {
      await this.voiceSessions.join(channel);
      return { status: 'joined' };
    } catch (error) {
      this.logger.error(`[${guildId}] Failed to join ${channel.id}`, error);
      return { status: 'connect-failed' };
    }
  }
}
