import { Injectable, Logger } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import { Context, SlashCommand, type SlashCommandContext } from 'necord';
import { replyGuildOnly } from '../discord/guild-only';
import { VoiceSessionService } from './voice-session.service';

@Injectable()
export class VoiceCommands {
  private readonly logger = new Logger(VoiceCommands.name);

  constructor(private readonly voiceSessions: VoiceSessionService) {}

  @SlashCommand({
    name: 'join',
    description: 'Join your voice channel and start tracking phrases',
    dmPermission: false,
  })
  async join(@Context() [interaction]: SlashCommandContext) {
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

  @SlashCommand({
    name: 'leave',
    description: 'Leave the voice channel and stop tracking',
    dmPermission: false,
  })
  leave(@Context() [interaction]: SlashCommandContext) {
    const { guildId } = interaction;
    if (!guildId) return replyGuildOnly(interaction);
    const left = this.voiceSessions.leave(guildId);
    return interaction.reply(
      left ? '👋 Stopped listening.' : "I'm not in a voice channel.",
    );
  }
}
