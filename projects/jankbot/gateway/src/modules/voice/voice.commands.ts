import { Injectable, Logger } from '@nestjs/common';
import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { VoiceSessionService } from './voice-session.service';

/**
 * `/join` and `/leave`. These live in the gateway because they act on the voice connection it owns
 * and report back whether connecting worked. core still registers their definitions.
 */
@Injectable()
export class VoiceCommands {
  private readonly logger = new Logger(VoiceCommands.name);

  constructor(private readonly voiceSessions: VoiceSessionService) {}

  handle(interaction: ChatInputCommandInteraction) {
    switch (interaction.commandName) {
      case 'join':
        return this.join(interaction);
      case 'leave':
        return this.leave(interaction);
      default:
        throw new Error(`Not a voice command: /${interaction.commandName}`);
    }
  }

  private async join(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      return interaction.reply({
        content: 'This command only works in a server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.member.voice.channel;
    if (!channel) {
      return interaction.reply({
        content: 'Join a voice channel first, then run `/join`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!channel.joinable) {
      return interaction.reply({
        content: `I don't have permission to join ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Connecting can take a few seconds, longer than Discord's 3s interaction deadline.
    await interaction.deferReply();
    try {
      await this.voiceSessions.join(channel);
      return interaction.editReply(`👂 Listening in ${channel}.`);
    } catch (error) {
      this.logger.error(`Failed to join ${channel.id}`, error);
      return interaction.editReply(
        `Couldn't connect to ${channel}. Try again?`,
      );
    }
  }

  private async leave(interaction: ChatInputCommandInteraction) {
    const { guildId } = interaction;
    if (!guildId) {
      return interaction.reply({
        content: 'This command only works in a server.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const left = await this.voiceSessions.leave(guildId);
    return interaction.reply(
      left ? '👋 Stopped listening.' : "I'm not in a voice channel.",
    );
  }
}
