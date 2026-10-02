import {
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';

/**
 * Commands the gateway handles itself, because they act on its voice connections. core registers
 * these along with its own commands; every other command is core's alone and lives in core.
 */
export const GATEWAY_COMMANDS = {
  join: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel and start tracking phrases')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  leave: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and stop tracking')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
} satisfies Record<string, RESTPostAPIChatInputApplicationCommandsJSONBody>;

export type GatewayCommandName = keyof typeof GATEWAY_COMMANDS;

export function isGatewayCommand(name: string): name is GatewayCommandName {
  return Object.hasOwn(GATEWAY_COMMANDS, name);
}
