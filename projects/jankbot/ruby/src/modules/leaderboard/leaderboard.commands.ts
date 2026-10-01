import { Injectable } from '@nestjs/common';
import { userMention } from 'discord.js';
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord';
import { MAX_PHRASE_LENGTH } from '@universe/phrase-matching';
import { replyGuildOnly } from '../discord/guild-only';
import { LeaderboardService } from './leaderboard.service';

class LeaderboardDto {
  @StringOption({
    name: 'phrase',
    description: 'The tracked word or phrase to rank people by',
    required: true,
    max_length: MAX_PHRASE_LENGTH,
  })
  phrase!: string;
}

@Injectable()
export class LeaderboardCommands {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @SlashCommand({
    name: 'leaderboard',
    description: 'Show who says a tracked phrase the most',
    dmPermission: false,
  })
  async leaderboardCommand(
    @Context() [interaction]: SlashCommandContext,
    @Options() { phrase }: LeaderboardDto,
  ) {
    const { guildId } = interaction;
    if (!guildId) return replyGuildOnly(interaction);
    const entries = await this.leaderboard.getLeaderboard(guildId, phrase);
    if (entries.length === 0) {
      return interaction.reply(`Nobody has said "${phrase}" yet.`);
    }

    const lines = entries.map(
      (entry, i) =>
        `**${i + 1}.** ${userMention(entry.userId)} — ${entry.count}`,
    );
    return interaction.reply({
      content: `**"${phrase}" leaderboard**\n${lines.join('\n')}`,
      // Don't ping everyone on the leaderboard.
      allowedMentions: { parse: [] },
    });
  }
}
