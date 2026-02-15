import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

const reconnectionDelays = [1000, 2000, 5000, 10000];

export abstract class WebSocketService {
  protected abstract logger: Logger;

  private ws: WebSocket;
  private readonly queuedMessages: string[] = [];
  private reconnectionTimer: NodeJS.Timeout | null = null;
  private reconnectionAttempts = 0;
  private isShuttingDown = false;

  constructor(private readonly websocketUrl: string) {
    this.ws = new WebSocket(this.websocketUrl);
    this.setupLifecycleEventListeners();
  }

  protected abstract handleMessage(data: WebSocket.Data): void;

  private setupLifecycleEventListeners() {
    this.ws.on('open', () => {
      this.onOpen();
      this.logger.debug('WebSocket connection opened');
      this.reconnectionAttempts = 0;
      this.flushQueuedMessages();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('ping', () => {
      this.onPing();
    });

    this.ws.on('error', (error) => {
      this.onError(error);
      this.logger.error(`WebSocket error: ${error.message}`);
      this.ws.close();
    });

    this.ws.on('close', (code, reason) => {
      this.onClose(code, reason.toString());
      this.logger.warn(`WebSocket closed: ${code} - ${reason.toString()}`);
      this.scheduleReconnect();
    });
  }

  protected onOpen() {
    // empty
  }

  protected onError(_error: Error) {
    // empty
  }

  protected onClose(_code: number, _reason: string) {
    // empty
  }

  protected onPing() {
    // empty
  }

  private flushQueuedMessages() {
    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift();
      if (message) {
        this.ws.send(message);
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectionTimer || this.isShuttingDown) {
      return;
    }

    const delay = reconnectionDelays[Math.min(this.reconnectionAttempts, reconnectionDelays.length - 1)];
    this.logger.debug(`Reconnecting to WebSocket in ${delay} ms`);
    this.reconnectionTimer = setTimeout(() => {
      this.reconnectionAttempts++;
      this.reconnectionTimer = null;
      this.ws = new WebSocket(this.websocketUrl);
      this.setupLifecycleEventListeners();
    }, delay);
  }

  /** Gracefully close the WebSocket connection */
  public close() {
    this.isShuttingDown = true;

    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer);
      this.reconnectionTimer = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Graceful shutdown');
    }

    this.logger.debug('WebSocket connection closed gracefully');
  }

  public reconnect() {
    this.logger.debug('Restarting WebSocket connection...');
    this.close();
    this.isShuttingDown = false;
    this.ws = new WebSocket(this.websocketUrl);
    this.setupLifecycleEventListeners();
  }

  protected send(message: unknown) {
    const payload = JSON.stringify(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.logger.debug('Buffering message (WS not ready)');
      this.queuedMessages.push(payload);
    }
  }
}
