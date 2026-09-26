import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

/**
 * Commands are registered with `dmPermission: false`, so this is only a fallback in case one
 * is used outside a server anyway.
 */
export function replyGuildOnly(interaction: ChatInputCommandInteraction) {
  return interaction.reply({
    content: 'This command only works in a server.',
    flags: MessageFlags.Ephemeral,
  });
}
