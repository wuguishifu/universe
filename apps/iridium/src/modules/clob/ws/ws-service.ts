import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

const reconnectionDelays = [1000, 2000, 5000, 10000];

export abstract class WebSocketService {
  protected abstract logger: Logger;

  private ws: WebSocket;
  private readonly queuedMessages: string[] = [];
  private reconnectionTimer: NodeJS.Timeout | null = null;
  private reconnectionAttempts = 0;

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

  private flushQueuedMessages() {
    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift();
      if (message) {
        this.ws.send(message);
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectionTimer) {
      return;
    }

    const delay = reconnectionDelays[Math.min(this.reconnectionAttempts, reconnectionDelays.length - 1)];
    this.logger.debug(`Reconnecting to CLOB WebSocket in ${delay} ms`);
    this.reconnectionTimer = setTimeout(() => {
      this.reconnectionAttempts++;
      this.reconnectionTimer = null;
      this.ws = new WebSocket(this.websocketUrl);
      this.setupLifecycleEventListeners();
    }, delay);
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
