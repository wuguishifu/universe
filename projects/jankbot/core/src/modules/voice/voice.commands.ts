import { Injectable } from '@nestjs/common';
import {
  channelMention,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import { z } from 'zod';
import { RedisCacheService } from '@libs/nest-common';
import {
  type VoiceCommandResult,
  voiceBotId,
} from '@projects/jankbot-contracts';
import { CORE_REDIS } from '../../config/redis-keys';
import { type InteractionReply } from '../discord/discord-rest.service';
import {
  type CommandHandler,
  type CommandInteraction,
  GUILD_ONLY_REPLY,
  parseOptions,
} from '../interactions/command-handler';
import { VoiceBotsService, type VoiceBotStatus } from './voice-bots.service';
import { VoiceCommandClient } from './voice-command.client';

const botOptions = z.object({ bot: z.string().optional() });

/** Outlasts a join (VoiceCommandClient gives up after 30s), in case core dies mid-join. */
const JOIN_CLAIM_TTL_SECONDS = 60;

/** Resolves the optional `bot` option. Undefined means it wasn't given; null means no such bot. */
function requestedBot(
  bots: VoiceBotsService,
  interaction: CommandInteraction,
): string | null | undefined {
  const { bot } = parseOptions(interaction, botOptions);
  if (bot === undefined) return undefined;
  return bots.find(bot) ?? null;
}

const unknownBotReply = (
  interaction: CommandInteraction,
): InteractionReply => ({
  content: `I don't know a bot called "${String(interaction.options['bot'])}".`,
});

/** Why a bot can't be sent anywhere, or undefined if it's free. */
function unavailableReason(status: VoiceBotStatus): string | undefined {
  switch (status.state) {
    case 'offline':
      return `${status.name} is offline right now.`;
    case 'not-in-guild':
      return `${status.name} isn't in this server. Invite it first.`;
    case 'in-channel':
      return `${status.name} is already listening in ${channelMention(status.channelId)}.`;
    case 'free':
      return undefined;
  }
}

function resultReply(
  name: string,
  channelId: string | undefined,
  result: VoiceCommandResult | 'timeout',
): InteractionReply {
  const channel = channelId ? channelMention(channelId) : 'the channel';
  if (result === 'timeout') {
    return { content: `${name} didn't respond in time. Try again?` };
  }
  switch (result.status) {
    case 'joined':
      return { content: `👂 ${name} is listening in ${channel}.` };
    case 'left':
      return { content: `👋 ${name} stopped listening.` };
    case 'not-connected':
      return { content: `${name} isn't in a voice channel.` };
    case 'channel-unavailable':
      return { content: `${name} doesn't have permission to join ${channel}.` };
    case 'connect-failed':
      return { content: `${name} couldn't connect to ${channel}. Try again?` };
    case 'expired':
      return { content: `${name} didn't respond in time. Try again?` };
  }
}

/** The `bot` option. Its choices are VOICE_BOTS, so users pick from a list instead of typing names. */
function botOption(bots: VoiceBotsService, description: string) {
  return (option: SlashCommandStringOption) =>
    option
      .setName('bot')
      .setDescription(description)
      .addChoices(
        bots.names.map((name) => ({ name, value: voiceBotId(name) })),
      );
}

/**
 * `/join [bot]`: sends a voice bot to the caller's channel. Without `bot`, it's the first free one
 * in VOICE_BOTS order.
 */
@Injectable()
export class JoinCommand implements CommandHandler {
  readonly ephemeral = false;
  readonly definition;

  constructor(
    private readonly bots: VoiceBotsService,
    private readonly voiceCommands: VoiceCommandClient,
    private readonly cache: RedisCacheService,
  ) {
    this.definition = new SlashCommandBuilder()
      .setName('join')
      .setDescription('Join your voice channel and start tracking phrases')
      .setContexts(InteractionContextType.Guild)
      .addStringOption(
        botOption(bots, 'Which bot to send (default: any free one)'),
      )
      .toJSON();
  }

  async handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const { guildId, voiceChannelId } = interaction;
    if (!guildId) return GUILD_ONLY_REPLY;
    const requested = requestedBot(this.bots, interaction);
    if (requested === null) return unknownBotReply(interaction);
    if (!voiceChannelId) {
      return { content: 'Join a voice channel first, then run `/join`.' };
    }

    const statuses = await this.bots.statuses(guildId);
    const alreadyHere = statuses.find(
      (status) =>
        status.state === 'in-channel' && status.channelId === voiceChannelId,
    );
    if (alreadyHere) {
      return {
        content: `${alreadyHere.name} is already listening in ${channelMention(voiceChannelId)}.`,
      };
    }

    if (requested) {
      const status = statuses.find(({ name }) => name === requested);
      const reason = status && unavailableReason(status);
      if (reason) return { content: reason };
      return (
        (await this.tryJoin(requested, guildId, voiceChannelId)) ?? {
          content: `${requested} is busy. Try again?`,
        }
      );
    }

    for (const status of statuses) {
      if (status.state !== 'free') continue;
      const reply = await this.tryJoin(status.name, guildId, voiceChannelId);
      if (reply) return reply;
    }
    return {
      content: [
        'No bots are free right now:',
        ...statuses.map(
          (status) =>
            `• ${unavailableReason(status) ?? `${status.name} was just taken.`}`,
        ),
      ].join('\n'),
    };
  }

  /**
   * Claims the bot for this guild and sends it. Undefined if it was taken in the meantime (by
   * another /join, or someone moved it into a channel), so the caller can try the next one.
   */
  private async tryJoin(
    name: string,
    guildId: string,
    channelId: string,
  ): Promise<InteractionReply | undefined> {
    const claim = {
      key: CORE_REDIS.joinClaims,
      id: `${voiceBotId(name)}:${guildId}`,
    };
    const token = await this.cache.tryAcquireLock({
      ...claim,
      ttlSeconds: JOIN_CLAIM_TTL_SECONDS,
    });
    if (!token) return undefined;
    try {
      // The statuses were read before the claim; another /join may have finished in between.
      const status = await this.bots.status(name, guildId);
      if (status.state !== 'free') return undefined;
      const result = await this.voiceCommands.send(name, {
        guildId,
        command: { action: 'join', channelId },
      });
      return resultReply(name, channelId, result);
    } finally {
      await this.cache.releaseLock({ ...claim, token });
    }
  }
}

/**
 * `/leave [bot]`: disconnects the named bot, or else the one in the caller's voice channel.
 */
@Injectable()
export class LeaveCommand implements CommandHandler {
  readonly ephemeral = false;
  readonly definition;

  constructor(
    private readonly bots: VoiceBotsService,
    private readonly voiceCommands: VoiceCommandClient,
  ) {
    this.definition = new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Make a bot leave its voice channel and stop tracking')
      .setContexts(InteractionContextType.Guild)
      .addStringOption(
        botOption(
          bots,
          'Which bot to disconnect (default: the one in your channel)',
        ),
      )
      .toJSON();
  }

  async handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const { guildId, voiceChannelId } = interaction;
    if (!guildId) return GUILD_ONLY_REPLY;
    const requested = requestedBot(this.bots, interaction);
    if (requested === null) return unknownBotReply(interaction);
    if (!requested && !voiceChannelId) {
      return {
        content:
          "Join the bot's voice channel first, or pick one with `/leave bot:<name>`.",
      };
    }

    const target = requested
      ? await this.bots.status(requested, guildId)
      : (await this.bots.statuses(guildId)).find(
          (status) =>
            status.state === 'in-channel' &&
            status.channelId === voiceChannelId,
        );
    if (!target) {
      return {
        content:
          'No bot is listening in your channel. Pick one with `/leave bot:<name>`.',
      };
    }
    if (target.state === 'free') {
      return { content: `${target.name} isn't in a voice channel.` };
    }
    if (target.state !== 'in-channel') {
      return { content: unavailableReason(target) };
    }

    const result = await this.voiceCommands.send(target.name, {
      guildId,
      command: { action: 'leave' },
    });
    return resultReply(target.name, target.channelId, result);
  }
}
