import { Module } from '@nestjs/common';

import { UniverseDbModule } from '@libs/nest-universe-db';

import { BotModule } from '../bot/bot.module';
import { EnvironmentModule, EnvironmentService } from '../config/environment';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    UniverseDbModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        connectionString: env.environment.universeDbConnectionString,
      }),
    }),
    BotModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
