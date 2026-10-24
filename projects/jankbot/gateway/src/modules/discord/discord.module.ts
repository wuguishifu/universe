import { Module } from '@nestjs/common';
import { IntentsBitField } from 'discord.js';
import { NecordModule } from 'necord';
import { EnvironmentService } from '../../config/environment';
import { DiscordLifecycle } from './discord.lifecycle';

@Module({
  imports: [
    NecordModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        token: environmentService.environment.discordToken,
        // GuildVoiceStates is required both to find the caller's channel and to receive audio.
        intents: [
          IntentsBitField.Flags.Guilds,
          IntentsBitField.Flags.GuildVoiceStates,
        ],
        // jankbot-core registers every command over REST. Necord registering here would replace
        // them with the (empty) set of commands declared in the gateway.
        skipRegistration: true,
      }),
    }),
  ],
  providers: [DiscordLifecycle],
})
export class DiscordModule {}
