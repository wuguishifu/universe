import { Log } from '../host/ports';

export type SocketStatus =
  'connected' | 'disconnected' | 'reconnecting' | 'failed';

export type SocketHandlers = {
  /** Sent right after the socket opens: usually the auth message. */
  onOpen: (send: (message: unknown) => void) => void;
  /** Each parsed JSON frame. Call `ready()` once authenticated and subscribed. */
  onMessage: (
    message: unknown,
    send: (message: unknown) => void,
    ready: () => void,
  ) => void;
  onStatus: (status: SocketStatus, details?: Record<string, unknown>) => void;
};

/**
 * A websocket that keeps itself connected: backs off from 1s to 30s between attempts and resets
 * the backoff once the handlers say the connection is ready. Uses Node's built-in WebSocket.
 */
export class ReconnectingSocket {
  private readonly url: string;
  private readonly name: string;
  private readonly handlers: SocketHandlers;
  private readonly log: Log;
  private socket: WebSocket | undefined;
  private stopped = true;
  private backoffMs = 1_000;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(options: {
    url: string;
    name: string;
    handlers: SocketHandlers;
    log: Log;
  }) {
    this.url = options.url;
    this.name = options.name;
    this.handlers = options.handlers;
    this.log = options.log;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  /** Drops the connection and opens a new one, e.g. when data looks stale. */
  reconnect(reason: string): void {
    if (this.stopped) return;
    this.log.warn(`${this.name}: reconnecting`, { reason });
    this.socket?.close();
  }

  /** Stops retrying for good (bad credentials, say). */
  fail(reason: string): void {
    this.log.error(`${this.name}: giving up`, { reason });
    this.handlers.onStatus('failed', { reason });
    this.stop();
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const send = (message: unknown) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
    };
    const ready = () => {
      this.backoffMs = 1_000;
      this.handlers.onStatus('connected');
    };

    socket.addEventListener('open', () => {
      this.log.info(`${this.name}: open`);
      this.handlers.onOpen(send);
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data;
      const text =
        data instanceof ArrayBuffer
          ? new TextDecoder().decode(data)
          : String(data);
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        this.log.warn(`${this.name}: unparseable frame`, {
          text: text.slice(0, 200),
        });
        return;
      }
      try {
        this.handlers.onMessage(message, send, ready);
      } catch (error) {
        this.log.error(`${this.name}: handler failed`, {
          error: String(error),
        });
      }
    });
    socket.addEventListener('error', (event) => {
      const error = String(Reflect.get(event, 'message') ?? event.type);
      this.log.warn(`${this.name}: socket error`, { error });
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.stopped) return;
      this.handlers.onStatus('disconnected', {
        code: event.code,
        reason: event.reason,
      });
      const delay = this.backoffMs;
      this.backoffMs = Math.min(30_000, this.backoffMs * 2);
      this.handlers.onStatus('reconnecting', { delayMs: delay });
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
