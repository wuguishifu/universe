import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  EPHEMERAL_COMMANDS_KEY,
  GATEWAY_COMMANDS,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment-service';
import { RedisService } from '../common/redis.service';
import { DiscordRestService } from '../discord/discord-rest.service';
import { CommandRegistry } from './command-registry';

/**
 * Registers every jankbot command (the gateway's from contracts, plus core's own) so command
 * definitions change with a core deploy. The gateway runs Necord with registration turned off so it
 * can't overwrite these.
 */
@Injectable()
export class CommandRegistrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommandRegistrationService.name);

  constructor(
    private readonly discord: DiscordRestService,
    private readonly redis: RedisService,
    private readonly registry: CommandRegistry,
    private readonly environmentService: EnvironmentService,
  ) {}

  async onApplicationBootstrap() {
    // Before registering, so the gateway already knows how to defer a new command when it appears.
    await this.publishEphemeralCommands();
    await this.registerCommands();
  }

  private async publishEphemeralCommands() {
    const names = this.registry.handlers
      .filter((handler) => handler.ephemeral)
      .map((handler) => handler.definition.name);
    try {
      const transaction = this.redis.client.multi().del(EPHEMERAL_COMMANDS_KEY);
      if (names.length > 0) transaction.sadd(EPHEMERAL_COMMANDS_KEY, ...names);
      await transaction.exec();
    } catch (error) {
      // The previous set stays; at worst a reply is deferred with the wrong visibility.
      this.logger.error('Failed to publish ephemeral commands', error);
    }
  }

  private async registerCommands() {
    const { discordDevGuildIds } = this.environmentService.environment;
    const commands = [
      ...Object.values(GATEWAY_COMMANDS),
      ...this.registry.handlers.map((handler) => handler.definition),
    ];

    // Failing here leaves the previously registered commands in place, which still work.
    try {
      const applicationId = await this.discord.getApplicationId();
      if (discordDevGuildIds.length === 0) {
        await this.discord.putCommands(applicationId, commands);
        this.logger.log(`Registered ${commands.length} global commands`);
        return;
      }
      for (const guildId of discordDevGuildIds) {
        await this.discord.putCommands(applicationId, commands, guildId);
      }
      this.logger.log(
        `Registered ${commands.length} commands in ${discordDevGuildIds.length} dev guild(s)`,
      );
    } catch (error) {
      this.logger.error('Failed to register commands', error);
    }
  }
}
