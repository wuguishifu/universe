import {
  type AuthInfo,
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import {
  All,
  Controller,
  Inject,
  Logger,
  type OnModuleDestroy,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { McpToolset } from '@platform/mcp-toolkit';

import { EnvironmentService } from '../../config/environment';
import { OAuthService } from '../oauth/oauth.service';

import { TOOLSETS } from './toolsets';
import { toWebRequest } from './web-request';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The MCP endpoint (Streamable HTTP). Stateless: every request gets a fresh server with every
 * toolset registered, so nothing is kept between requests but the access token.
 */
@Controller('mcp')
export class McpController implements OnModuleDestroy {
  private readonly logger = new Logger(McpController.name);
  private readonly origin: string;
  private readonly allowedOrigins: string[];
  private readonly authenticate: (
    request: Request,
  ) => Promise<AuthInfo | Response>;
  private readonly handler: McpHttpHandler;

  constructor(
    environmentService: EnvironmentService,
    oauthService: OAuthService,
    @Inject(TOOLSETS) toolsets: McpToolset[],
  ) {
    const { publicUrl, allowedOrigins, version } =
      environmentService.environment;
    this.origin = publicUrl;
    this.allowedOrigins = [new URL(publicUrl).hostname, ...allowedOrigins];
    this.authenticate = requireBearerAuth({
      verifier: {
        verifyAccessToken: (token) => oauthService.verifyAccessToken(token),
      },
      resourceMetadataUrl: oauthService.resourceMetadataUrl,
    });
    this.handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'universe', version });
        for (const toolset of toolsets) toolset.register(server);
        return server;
      },
      { onerror: (error) => this.logger.warn(error.message) },
    );
    this.logger.log(
      `Serving ${toolsets.map(({ name }) => name).join(', ')} at ${oauthService.resource}`,
    );
  }

  async onModuleDestroy() {
    await this.handler.close();
  }

  @All()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const webRequest = toWebRequest(request, reply, this.origin);
    const rejected = originValidationResponse(webRequest, this.allowedOrigins);
    if (rejected) return reply.send(rejected);

    const authInfo = await this.authenticate(webRequest);
    if (authInfo instanceof Response) return reply.send(authInfo);

    this.logToolCalls(request.body, authInfo);
    return reply.send(
      await this.handler.fetch(webRequest, {
        authInfo,
        parsedBody: request.body,
      }),
    );
  }

  /** Who called what, since tools can change things in the house. */
  private logToolCalls(body: unknown, { clientId }: AuthInfo) {
    for (const message of Array.isArray(body) ? body : [body]) {
      if (
        isRecord(message) &&
        message.method === 'tools/call' &&
        isRecord(message.params)
      ) {
        this.logger.log(`${clientId} called ${String(message.params.name)}`);
      }
    }
  }
}
