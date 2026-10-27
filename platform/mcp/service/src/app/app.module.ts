import { Module } from '@nestjs/common';

import { RedisCacheModule } from '@libs/nest-redis-cache';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { McpModule } from '../modules/mcp/mcp.module';
import { OAuthModule } from '../modules/oauth/oauth.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    RedisCacheModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        url: env.environment.redisUrl,
      }),
    }),
    OAuthModule,
    McpModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
