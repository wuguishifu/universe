import { Injectable, Logger } from '@nestjs/common';
import { Client, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { FeedGuild } from '@universe/contracts-ruby';

/** Decides which servers a sapphire viewer may see on ruby's sockets. */
@Injectable()
export class ViewerGuildsService {
  private readonly logger = new Logger(ViewerGuildsService.name);

  constructor(private readonly client: Client) {}

  /** The servers ruby is in that this Discord user is also a member of. */
  async getGuildsForUser(userId: string): Promise<FeedGuild[]> {
    const guilds = [...this.client.guilds.cache.values()];
    const memberships = await Promise.all(
      guilds.map(async (guild) => {
        try {
          // force: without the GuildMembers intent ruby never hears about members leaving,
          // so the member cache can't be trusted for access checks.
          await guild.members.fetch({ user: userId, force: true });
          return true;
        } catch (error) {
          if (
            error instanceof DiscordAPIError &&
            error.code === RESTJSONErrorCodes.UnknownMember
          ) {
            return false;
          }
          this.logger.warn(
            `[${guild.id}] couldn't check membership of ${userId}: ${errorMessage(error)}`,
          );
          return false;
        }
      }),
    );

    return guilds
      .filter((_, index) => memberships[index])
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 64 }),
      }));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
