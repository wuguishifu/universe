import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import {
  FEED_CLOSE_CODES,
  type FeedServerMessage,
  RUBY_FEED_SOCKET_PATH,
  verifyFeedTicket,
} from '@universe/contracts-ruby';
import { EnvironmentService } from '../../environment/environment-service';
import { FeedService } from './feed.service';

/** Cloudflare drops tunnel WebSockets that are idle for ~100s, so ping well inside that. */
const HEARTBEAT_MS = 30_000;

type FeedClient = {
  subscription?: Subscription;
  heartbeat?: NodeJS.Timeout;
  alive: boolean;
};

/**
 * Live transcripts for the sapphire feed page. Browsers connect with a short-lived ticket
 * signed by sapphire; each connection only gets servers its Discord user is a member of.
 * Membership is checked once on connect, so a reconnect is needed to pick up changes.
 */
@WebSocketGateway({ path: RUBY_FEED_SOCKET_PATH })
export class FeedGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(FeedGateway.name);
  private readonly clients = new Map<WebSocket, FeedClient>();

  constructor(
    private readonly feed: FeedService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage) {
    const client: FeedClient = { alive: true };
    this.clients.set(socket, client);

    const ticket = new URL(
      request.url ?? '',
      'http://localhost',
    ).searchParams.get('ticket');
    const payload = ticket
      ? await verifyFeedTicket(
          ticket,
          this.environmentService.environment.rubyFeedSecret,
        )
      : null;
    if (!payload) {
      socket.close(FEED_CLOSE_CODES.unauthorized, 'unauthorized');
      return;
    }

    const guilds = await this.feed.getGuildsForUser(payload.sub);
    // The socket may have closed while membership was being checked.
    if (!this.clients.has(socket)) return;

    const guildIds = new Set(guilds.map((guild) => guild.id));
    // Snapshot and subscribe in the same tick, so no utterance falls between them.
    this.send(socket, {
      type: 'ready',
      guilds,
      utterances: this.feed.getHistory(guildIds),
    });
    client.subscription = this.feed.added$.subscribe((utterance) => {
      if (guildIds.has(utterance.guildId)) {
        this.send(socket, { type: 'utterance', utterance });
      }
    });

    socket.on('pong', () => (client.alive = true));
    client.heartbeat = setInterval(() => {
      if (!client.alive) {
        socket.terminate();
        return;
      }
      client.alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    this.logger.debug(`${payload.sub} connected (${guilds.length} servers)`);
  }

  handleDisconnect(socket: WebSocket) {
    const client = this.clients.get(socket);
    client?.subscription?.unsubscribe();
    clearInterval(client?.heartbeat);
    this.clients.delete(socket);
  }

  private send(socket: WebSocket, message: FeedServerMessage) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}
