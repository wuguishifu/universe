import { Module } from '@nestjs/common';

import { OAuthModule } from '../oauth/oauth.module';

import { McpController } from './mcp.controller';
import { toolsetsProvider } from './toolsets';

@Module({
  imports: [OAuthModule],
  controllers: [McpController],
  providers: [toolsetsProvider],
})
export class McpModule {}
