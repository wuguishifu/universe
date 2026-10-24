import { UnrecoverableError } from 'bullmq';
import { type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { type z } from 'zod';

import { type JankbotJobData } from '@projects/jankbot-contracts';

import { type InteractionReply } from '../discord/discord-rest.service';

export type CommandInteraction = JankbotJobData<'interactions'>;

/** One top-level command: its definition, and how to answer it. */
export interface CommandHandler {
  readonly definition: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Whether the gateway should defer the reply as ephemeral (only the caller sees it). */
  readonly ephemeral: boolean;
  /** The returned reply replaces the gateway's deferred "thinking..." message. */
  handle(interaction: CommandInteraction): Promise<InteractionReply>;
}

/**
 * Commands are registered as guild-only, so this is only a fallback in case one is used outside a
 * server anyway.
 */
export const GUILD_ONLY_REPLY: InteractionReply = {
  content: 'This command only works in a server.',
};

/** Options that don't match the command definition won't match on a retry either, so don't retry. */
export function parseOptions<S extends z.ZodType>(
  interaction: CommandInteraction,
  schema: S,
): z.infer<S> {
  const result = schema.safeParse(interaction.options);
  if (!result.success) {
    throw new UnrecoverableError(
      `Invalid options for /${interaction.commandName}: ${result.error.message}`,
    );
  }
  return result.data;
}
