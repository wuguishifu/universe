import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { Data } from 'ws';

import { WebSocketService } from './ws-service';
import { CLOB_USER_WS_URL } from '../../../constants/constants';
import { Message } from '../../../types/clob/message';
import { OrderMessage } from '../../../types/clob/orderMessage';
import { AuthService } from '../../auth/auth.service';

type UserCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

@Injectable()
export class UserWsService extends WebSocketService implements OnModuleInit, OnModuleDestroy {
  protected readonly logger = new Logger(UserWsService.name);
  private userCredentials: UserCredentials | null = null;

  private readonly orderUpdateSubject = new Subject<OrderMessage>();
  public readonly orderUpdates$ = this.orderUpdateSubject.asObservable();

  constructor(private readonly authService: AuthService) {
    super(CLOB_USER_WS_URL);
  }

  onModuleDestroy() {
    this.logger.log('Shutting down User WebSocket...');
    this.orderUpdateSubject.complete();
    this.close();
  }

  onModuleInit() {
    this.authService.authBundle$.subscribe(({ credentials }) => {
      this.authenticate({
        apiKey: credentials.key,
        secret: credentials.secret,
        passphrase: credentials.passphrase,
      });
    });
  }

  protected handleMessage(data: Data): void {
    try {
      const parsed = JSON.parse(data.toString());
      const messages: Message[] = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach((message) => {
        if (message.event_type === 'order') {
          this.orderUpdateSubject.next(message);
        }
      });
    } catch (error) {
      this.logger.error('Failed to parse message', error);
    }
  }

  protected onOpen(): void {
    if (this.userCredentials) {
      this.logger.log('User WebSocket reconnected, re-authenticating...');
      this.send({ type: 'user', auth: this.userCredentials });
    }
  }

  public authenticate(userCredentials: UserCredentials) {
    this.userCredentials = userCredentials;
    this.send({ type: 'user', auth: this.userCredentials });
    this.logger.log('User WebSocket authenticated');
  }
}
