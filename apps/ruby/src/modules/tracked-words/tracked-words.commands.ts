import { Injectable } from '@nestjs/common';
import { ConvexError } from 'convex/values';
import { MessageFlags } from 'discord.js';
import {
  Context,
  createCommandGroupDecorator,
  Options,
  type SlashCommandContext,
  StringOption,
  Subcommand,
} from 'necord';
import { MAX_PHRASE_LENGTH } from '@universe/phrase-matching';
import { replyGuildOnly } from '../discord/guild-only';
import { TrackedWordsService } from './tracked-words.service';

class PhraseDto {
  @StringOption({
    name: 'phrase',
    description: 'Word or phrase, e.g. "I don\'t know"',
    required: true,
    max_length: MAX_PHRASE_LENGTH,
  })
  phrase!: string;
}

const WordsCommands = createCommandGroupDecorator({
  name: 'words',
  description: 'Manage the words and phrases tracked in this server',
  dmPermission: false,
});

@Injectable()
@WordsCommands()
export class TrackedWordsCommands {
  constructor(private readonly trackedWords: TrackedWordsService) {}

  @Subcommand({ name: 'list', description: 'List tracked words and phrases' })
  async list(@Context() [interaction]: SlashCommandContext) {
    const { guildId } = interaction;
    if (!guildId) return replyGuildOnly(interaction);
    const phrases = await this.trackedWords.list(guildId);
    const content = phrases.length
      ? `Tracked phrases:\n${phrases.map((p) => `• ${p}`).join('\n')}`
      : 'No phrases are being tracked yet. Add one with `/words add`.';
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  @Subcommand({ name: 'add', description: 'Start tracking a word or phrase' })
  async add(
    @Context() [interaction]: SlashCommandContext,
    @Options() { phrase }: PhraseDto,
  ) {
    const { guildId } = interaction;
    if (!guildId) return replyGuildOnly(interaction);
    let content: string;
    try {
      const added = await this.trackedWords.add(guildId, phrase);
      content = added
        ? `Now tracking "${phrase}".`
        : `"${phrase}" is already tracked.`;
    } catch (error) {
      // The backend rejects invalid phrases and full guilds with a user-facing message.
      if (!(error instanceof ConvexError)) throw error;
      content = String(error.data);
    }
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  @Subcommand({ name: 'remove', description: 'Stop tracking a word or phrase' })
  async remove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { phrase }: PhraseDto,
  ) {
    const { guildId } = interaction;
    if (!guildId) return replyGuildOnly(interaction);
    const removed = await this.trackedWords.remove(guildId, phrase);
    return interaction.reply({
      content: removed
        ? `Stopped tracking "${phrase}".`
        : `"${phrase}" isn't being tracked.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
