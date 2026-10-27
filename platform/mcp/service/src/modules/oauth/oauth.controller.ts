import { OAuthError } from '@modelcontextprotocol/server';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ClientsService } from './clients.service';
import { OAuthErrorFilter } from './oauth-error.filter';
import { OAuthService } from './oauth.service';

@Controller()
@UseFilters(OAuthErrorFilter)
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly clientsService: ClientsService,
  ) {}

  @Get('.well-known/oauth-authorization-server')
  authorizationServerMetadata() {
    return this.oauthService.metadata;
  }

  /** Clients find it from the 401's `WWW-Authenticate`; the bare path is for ones that guess. */
  @Get([
    '.well-known/oauth-protected-resource/mcp',
    '.well-known/oauth-protected-resource',
  ])
  protectedResourceMetadata() {
    return this.oauthService.protectedResourceMetadata;
  }

  @Post('oauth/register')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  register(@Body() body: unknown) {
    return this.clientsService.register(body);
  }

  /** A browser visit: errors that can't go back to the client are shown as a page. */
  @Get('oauth/authorize')
  authorize(@Query() query: unknown, @Res() reply: FastifyReply) {
    return this.redirectOrShowError(reply, () =>
      this.oauthService.authorize(query),
    );
  }

  @Get('oauth/callback')
  callback(@Query() query: unknown, @Res() reply: FastifyReply) {
    return this.redirectOrShowError(reply, () =>
      this.oauthService.callback(query),
    );
  }

  @Post('oauth/token')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  token(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.oauthService.token(body, authorization);
  }

  private async redirectOrShowError(
    reply: FastifyReply,
    destination: () => Promise<string>,
  ) {
    try {
      // Explicitly 302: otherwise Fastify keeps the 200 Nest has already set.
      return reply.redirect(await destination(), 302);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      return reply.code(400).type('text/plain').send(error.message);
    }
  }
}
