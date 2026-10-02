import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
  MessageFlags,
} from 'discord.js';
import { Context, type ContextOf, On } from 'necord';
import { RedisCacheService } from '@libs/nest-common';
import {
  JANKBOT_QUEUE_CONFIG,
  JANKBOT_REDIS,
  type JankbotJobData,
  type JankbotQueue,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';

type OptionValue = JankbotJobData<'interactions'>['options'][string];

/** Discord gives 3s to defer, so don't let a slow Redis eat into it. */
const EPHEMERAL_LOOKUP_TIMEOUT_MS = 500;

/**
 * On the primary gateway, every slash command arrives here, is deferred, and is forwarded to
 * jankbot-core, which edits the deferred reply when it's done (including /join and /leave, which it
 * hands to whichever voice bot it picks). The gateway knows nothing about the commands themselves,
 * so adding or changing one never needs a gateway deploy.
 */
@Injectable()
export class InteractionRouter {
  private readonly logger = new Logger(InteractionRouter.name);
  private readonly isPrimary: boolean;

  constructor(
    private readonly cache: RedisCacheService,
    @Inject(JANKBOT_QUEUE_CONFIG.interactions.queueName)
    private readonly interactions: JankbotQueue<'interactions'>,
    environmentService: EnvironmentService,
  ) {
    this.isPrimary = environmentService.environment.role === 'primary';
  }

  @On('interactionCreate')
  async onInteraction(
    @Context() [interaction]: ContextOf<'interactionCreate'>,
  ) {
    if (!interaction.isChatInputCommand()) return;
    // Commands are registered on the primary bot only. A worker that gets one has stale commands
    // registered (e.g. its bot used to be the primary); answering would race the primary.
    if (!this.isPrimary) {
      this.logger.warn(
        `Ignoring /${interaction.commandName}: this gateway is a worker, but its bot has commands registered`,
      );
      return;
    }

    try {
      await this.forward(interaction);
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
      return await Promise.race([
        this.cache.setHas({
          key: JANKBOT_REDIS.ephemeralCommands,
          member: commandName,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('timed out')),
            EPHEMERAL_LOOKUP_TIMEOUT_MS,
          ),
        ),
      ]);
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
    voiceChannelId: interaction.inCachedGuild()
      ? interaction.member.voice.channelId
      : null,
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
