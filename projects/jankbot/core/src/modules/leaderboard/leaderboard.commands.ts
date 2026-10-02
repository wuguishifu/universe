import { Injectable } from '@nestjs/common';
import {
  InteractionContextType,
  SlashCommandBuilder,
  userMention,
} from 'discord.js';
import { z } from 'zod';
import { MAX_PHRASE_LENGTH } from '@libs/phrase-matching';
import { type InteractionReply } from '../discord/discord-rest.service';
import {
  type CommandHandler,
  type CommandInteraction,
  GUILD_ONLY_REPLY,
  parseOptions,
} from '../interactions/command-handler';
import { LeaderboardService } from './leaderboard.service';

const leaderboardOptions = z.object({ phrase: z.string() });

/** `/leaderboard phrase:<..>` */
@Injectable()
export class LeaderboardCommands implements CommandHandler {
  readonly ephemeral = false;
  readonly definition = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show who says a tracked phrase the most')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('phrase')
        .setDescription('The tracked word or phrase to rank people by')
        .setRequired(true)
        .setMaxLength(MAX_PHRASE_LENGTH),
    )
    .toJSON();

  constructor(private readonly leaderboard: LeaderboardService) {}

  async handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const { guildId } = interaction;
    if (!guildId) return GUILD_ONLY_REPLY;
    const { phrase } = parseOptions(interaction, leaderboardOptions);

    const entries = await this.leaderboard.getLeaderboard(guildId, phrase);
    if (entries.length === 0) {
      return { content: `Nobody has said "${phrase}" yet.` };
    }

    const lines = entries.map(
      (entry, i) =>
        `**${i + 1}.** ${userMention(entry.userId)} — ${entry.count}`,
    );
    return {
      content: `**"${phrase}" leaderboard**\n${lines.join('\n')}`,
      // Don't ping everyone on the leaderboard.
      allowed_mentions: { parse: [] },
    };
  }
}
