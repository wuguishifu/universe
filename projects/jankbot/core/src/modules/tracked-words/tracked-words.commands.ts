import { Injectable } from '@nestjs/common';
import { ConvexError } from 'convex/values';
import {
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandStringOption,
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
import { TrackedWordsService } from './tracked-words.service';

const phraseOptions = z.object({ phrase: z.string() });

const phraseOption = (option: SlashCommandStringOption) =>
  option
    .setName('phrase')
    .setDescription('Word or phrase, e.g. "I don\'t know"')
    .setRequired(true)
    .setMaxLength(MAX_PHRASE_LENGTH);

/** `/words list|add|remove` */
@Injectable()
export class TrackedWordsCommands implements CommandHandler {
  readonly ephemeral = true;
  readonly definition = new SlashCommandBuilder()
    .setName('words')
    .setDescription('Manage the words and phrases tracked in this server')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List tracked words and phrases'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Start tracking a word or phrase')
        .addStringOption(phraseOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Stop tracking a word or phrase')
        .addStringOption(phraseOption),
    )
    .toJSON();

  constructor(private readonly trackedWords: TrackedWordsService) {}

  handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const { guildId } = interaction;
    if (!guildId) return Promise.resolve(GUILD_ONLY_REPLY);

    switch (interaction.subcommand) {
      case 'list':
        return this.list(guildId);
      case 'add':
        return this.add(
          guildId,
          parseOptions(interaction, phraseOptions).phrase,
        );
      case 'remove':
        return this.remove(
          guildId,
          parseOptions(interaction, phraseOptions).phrase,
        );
      default:
        return Promise.resolve({ content: "I don't know that subcommand." });
    }
  }

  private async list(guildId: string): Promise<InteractionReply> {
    const phrases = await this.trackedWords.list(guildId);
    return {
      content: phrases.length
        ? `Tracked phrases:\n${phrases.map((p) => `• ${p}`).join('\n')}`
        : 'No phrases are being tracked yet. Add one with `/words add`.',
    };
  }

  private async add(
    guildId: string,
    phrase: string,
  ): Promise<InteractionReply> {
    try {
      const added = await this.trackedWords.add(guildId, phrase);
      return {
        content: added
          ? `Now tracking "${phrase}".`
          : `"${phrase}" is already tracked.`,
      };
    } catch (error) {
      // The backend rejects invalid phrases and full guilds with a user-facing message.
      if (!(error instanceof ConvexError)) throw error;
      return { content: String(error.data) };
    }
  }

  private async remove(
    guildId: string,
    phrase: string,
  ): Promise<InteractionReply> {
    const removed = await this.trackedWords.remove(guildId, phrase);
    return {
      content: removed
        ? `Stopped tracking "${phrase}".`
        : `"${phrase}" isn't being tracked.`,
    };
  }
}
