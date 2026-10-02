import { Injectable } from '@nestjs/common';
import {
  REST,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
  Routes,
} from 'discord.js';
import { z } from 'zod';
import { type JankbotJobData } from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';

const applicationSchema = z.object({ id: z.string() });

export type InteractionReply = RESTPatchAPIWebhookWithTokenMessageJSONBody;

/**
 * Discord's HTTP API. core never connects to the Discord gateway (the gateway service owns that
 * connection), so everything it does on Discord goes through here.
 */
@Injectable()
export class DiscordRestService {
  private readonly rest: REST;

  constructor(environmentService: EnvironmentService) {
    this.rest = new REST().setToken(
      environmentService.environment.discordToken,
    );
  }

  async getApplicationId(): Promise<string> {
    const application = applicationSchema.parse(
      await this.rest.get(Routes.currentApplication()),
    );
    return application.id;
  }

  /** Replaces the application's commands: globally, or in `guildId` only. */
  async putCommands(
    applicationId: string,
    commands: unknown[],
    guildId?: string,
  ): Promise<void> {
    await this.rest.put(
      guildId
        ? Routes.applicationGuildCommands(applicationId, guildId)
        : Routes.applicationCommands(applicationId),
      { body: commands },
    );
  }

  /** Edits the reply the gateway deferred. Authenticated by the interaction token, not the bot token. */
  async editReply(
    interaction: Pick<
      JankbotJobData<'interactions'>,
      'applicationId' | 'token'
    >,
    reply: InteractionReply,
  ): Promise<void> {
    await this.rest.patch(
      Routes.webhookMessage(
        interaction.applicationId,
        interaction.token,
        '@original',
      ),
      { body: reply, auth: false },
    );
  }
}
