import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import {
  INTERACTION_TOKEN_TTL_MS,
  JANKBOT_QUEUE_CONFIG,
  type JankbotQueueJob,
} from '@projects/jankbot-contracts';
import { DiscordRestService } from '../discord/discord-rest.service';
import { type CommandInteraction } from './command-handler';
import { CommandRegistry } from './command-registry';

/** Stop retrying with this much token lifetime left, so the failure message still gets through. */
const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

const isTokenExpired = (interaction: CommandInteraction) =>
  Date.now() - interaction.receivedAt >
  INTERACTION_TOKEN_TTL_MS - TOKEN_SAFETY_MARGIN_MS;

/** Answers the slash commands the primary gateway forwards. */
@Processor(JANKBOT_QUEUE_CONFIG.interactions.queueName, { concurrency: 8 })
export class InteractionProcessor extends WorkerHost {
  private readonly logger = new Logger(InteractionProcessor.name);
  constructor(
    private readonly discord: DiscordRestService,
    private readonly registry: CommandRegistry,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: JankbotQueueJob<'interactions'> | undefined,
    error: Error,
  ) {
    if (!job) {
      this.logger.error(`Interaction job failed: ${error.message}`);
      return;
    }
    const interaction = job.data;
    const attempts = job.opts.attempts ?? 1;
    const final =
      error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    const message = `[${interaction.guildId}] /${interaction.commandName}: attempt ${job.attemptsMade}/${attempts} failed: ${error.message}`;
    if (!final) {
      this.logger.warn(`${message} (will retry)`);
      return;
    }

    this.logger.error(`${message} (giving up)`);
    if (Date.now() - interaction.receivedAt > INTERACTION_TOKEN_TTL_MS) return;
    // Otherwise the deferred reply would say "thinking..." until Discord times it out.
    try {
      await this.discord.editReply(interaction, {
        content: 'Something went wrong. Try again?',
      });
    } catch (editError) {
      this.logger.warn(
        `Couldn't report the failure of ${interaction.interactionId}`,
        editError,
      );
    }
  }

  override async process(job: JankbotQueueJob<'interactions'>): Promise<void> {
    const interaction = job.data;
    if (isTokenExpired(interaction)) {
      throw new UnrecoverableError('Interaction token is about to expire');
    }

    const handler = this.registry.find(interaction.commandName);
    const reply = handler
      ? await handler.handle(interaction)
      : { content: "I don't know that command." };
    await this.discord.editReply(interaction, reply);
  }
}
