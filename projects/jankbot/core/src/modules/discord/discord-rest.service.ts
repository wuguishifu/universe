import { Injectable } from '@nestjs/common';
import {
  DiscordAPIError,
  REST,
  RESTJSONErrorCodes,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
  Routes,
} from 'discord.js';
import { z } from 'zod';
import { type JankbotJobData } from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';

const applicationSchema = z.object({ id: z.string() });
const voiceStateSchema = z.object({ channel_id: z.string().nullable() });

const isDiscordError = (error: unknown, code: RESTJSONErrorCodes) =>
  error instanceof DiscordAPIError && error.code === code;

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

  async isGuildMember(guildId: string, userId: string): Promise<boolean> {
    try {
      await this.rest.get(Routes.guildMember(guildId, userId));
      return true;
    } catch (error) {
      if (isDiscordError(error, RESTJSONErrorCodes.UnknownMember)) return false;
      throw error;
    }
  }

  /** The voice channel the user is in, or null. The user must be a member of the guild. */
  async getVoiceChannelId(
    guildId: string,
    userId: string,
  ): Promise<string | null> {
    try {
      const state = voiceStateSchema.parse(
        await this.rest.get(Routes.guildVoiceState(guildId, userId)),
      );
      return state.channel_id;
    } catch (error) {
      if (isDiscordError(error, RESTJSONErrorCodes.UnknownVoiceState)) {
        return null;
      }
      throw error;
    }
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
