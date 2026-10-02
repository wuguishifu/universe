import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
  MessageFlags,
} from 'discord.js';
import { Context, type ContextOf, On } from 'necord';
import {
  EPHEMERAL_COMMANDS_KEY,
  isGatewayCommand,
  JANKBOT_QUEUE_CONFIG,
  type JankbotJobData,
  type JankbotQueue,
} from '@projects/jankbot-contracts';
import { RedisService } from '../redis/redis.service';
import { VoiceCommands } from '../voice/voice.commands';

type OptionValue = JankbotJobData<'interactions'>['options'][string];

/** Discord gives 3s to defer, so don't let a slow Redis eat into it. */
const EPHEMERAL_LOOKUP_TIMEOUT_MS = 500;

/**
 * Every slash command arrives here. Voice commands run in the gateway; the rest are deferred and
 * forwarded to jankbot-core, which edits the deferred reply when it's done. The gateway knows
 * nothing else about core's commands, so adding or changing one never needs a gateway deploy.
 */
@Injectable()
export class InteractionRouter {
  private readonly logger = new Logger(InteractionRouter.name);

  constructor(
    private readonly voiceCommands: VoiceCommands,
    private readonly redis: RedisService,
    @Inject(JANKBOT_QUEUE_CONFIG.interactions.queueName)
    private readonly interactions: JankbotQueue<'interactions'>,
  ) {}

  @On('interactionCreate')
  async onInteraction(
    @Context() [interaction]: ContextOf<'interactionCreate'>,
  ) {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (isGatewayCommand(interaction.commandName)) {
        await this.voiceCommands.handle(interaction);
      } else {
        await this.forward(interaction);
      }
    } catch (error) {
      this.logger.error(`/${interaction.commandName} failed`, error);
    }
  }

  private async forward(interaction: ChatInputCommandInteraction) {
    const ephemeral = await this.isEphemeral(interaction.commandName);
    await interaction.deferReply(
      ephemeral ? { flags: MessageFlags.Ephemeral } : {},
    );
    try {
      await this.interactions.add(
        JANKBOT_QUEUE_CONFIG.interactions.jobName,
        toJobData(interaction),
        // Discord delivers each interaction once, but this keeps a duplicate from answering twice.
        { jobId: interaction.id },
      );
    } catch (error) {
      this.logger.error(`Failed to forward /${interaction.commandName}`, error);
      await interaction.editReply("Couldn't handle that right now. Try again?");
    }
  }

  /** core publishes its ephemeral commands on startup. If Redis can't say, reply publicly. */
  private async isEphemeral(commandName: string): Promise<boolean> {
    try {
      const isMember = await Promise.race([
        this.redis.client.sismember(EPHEMERAL_COMMANDS_KEY, commandName),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('timed out')),
            EPHEMERAL_LOOKUP_TIMEOUT_MS,
          ),
        ),
      ]);
      return isMember === 1;
    } catch (error) {
      this.logger.warn(
        `Couldn't check whether /${commandName} is ephemeral`,
        error,
      );
      return false;
    }
  }
}

function toJobData(
  interaction: ChatInputCommandInteraction,
): JankbotJobData<'interactions'> {
  return {
    interactionId: interaction.id,
    applicationId: interaction.applicationId,
    token: interaction.token,
    receivedAt: interaction.createdTimestamp,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    commandName: interaction.commandName,
    subcommandGroup: interaction.options.getSubcommandGroup(false),
    subcommand: interaction.options.getSubcommand(false),
    options: leafOptions(interaction.options.data),
  };
}

/** Flattens subcommand groups and subcommands down to the options the user actually filled in. */
function leafOptions(
  options: readonly CommandInteractionOption[],
): Record<string, OptionValue> {
  const values: Record<string, OptionValue> = {};
  for (const option of options) {
    if (
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      Object.assign(values, leafOptions(option.options ?? []));
    } else if (option.value !== undefined) {
      values[option.name] = option.value;
    }
  }
  return values;
}
