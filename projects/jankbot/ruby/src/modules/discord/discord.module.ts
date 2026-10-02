import { Module } from '@nestjs/common';
import { IntentsBitField } from 'discord.js';
import { NecordModule } from 'necord';
import { EnvironmentService } from '../../environment/environment-service';
import { DiscordLifecycle } from './discord.lifecycle';

@Module({
  imports: [
    NecordModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => {
        const { discordToken, discordDevGuildIds } =
          environmentService.environment;
        return {
          token: discordToken,
          // GuildVoiceStates is required both to find the caller's channel and to receive audio.
          intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildVoiceStates,
          ],
          development:
            discordDevGuildIds.length > 0 ? discordDevGuildIds : false,
        };
      },
    }),
  ],
  providers: [DiscordLifecycle],
})
export class DiscordModule {}
