import { Injectable } from '@nestjs/common';
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { type InteractionReply } from '../discord/discord-rest.service';
import {
  type CommandHandler,
  type CommandInteraction,
} from '../interactions/command-handler';
import { CompilationOptOutsService } from './compilation-opt-outs.service';

/** `/optout` */
@Injectable()
export class OptOutCommand implements CommandHandler {
  readonly ephemeral = true;
  readonly definition = new SlashCommandBuilder()
    .setName('optout')
    .setDescription('Leave your voice out of session compilations')
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(private readonly optOuts: CompilationOptOutsService) {}

  async handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const optedOut = await this.optOuts.optOut(interaction.userId);
    return {
      content: optedOut
        ? "You're opted out: your voice won't be in compilations, in any server. Use `/optin` to be included again."
        : "You're already opted out of compilations. Use `/optin` to be included again.",
    };
  }
}

/** `/optin` */
@Injectable()
export class OptInCommand implements CommandHandler {
  readonly ephemeral = true;
  readonly definition = new SlashCommandBuilder()
    .setName('optin')
    .setDescription('Include your voice in session compilations again')
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(private readonly optOuts: CompilationOptOutsService) {}

  async handle(interaction: CommandInteraction): Promise<InteractionReply> {
    const optedIn = await this.optOuts.optIn(interaction.userId);
    return {
      content: optedIn
        ? "You're opted back in: your voice will be in compilations again, in every server."
        : "You're already included in compilations. Use `/optout` to leave your voice out.",
    };
  }
}
