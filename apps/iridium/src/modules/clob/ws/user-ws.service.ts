import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject, take } from 'rxjs';
import { Data } from 'ws';

import { OsmiumService } from '@wuguishifu/nest-common';

import { WebSocketService } from '../../../common/ws-service';
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

  private readonly reconnectedSubject = new Subject<void>();
  /** Emits after the user WebSocket reconnects and re-authenticates. */
  public readonly reconnected$ = this.reconnectedSubject.asObservable();

  constructor(
    private readonly authService: AuthService,
    private readonly osmiumService: OsmiumService,
  ) {
    super(CLOB_USER_WS_URL);
  }

  public onModuleDestroy() {
    this.logger.debug('Shutting down User WebSocket...');
    this.orderUpdateSubject.complete();
    this.reconnectedSubject.complete();
    this.close();
  }

  public onModuleInit() {
    this.authService.authBundle$.pipe(take(1)).subscribe(({ credentials }) => {
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
      this.logger.debug('User WebSocket reconnected, re-authenticating...');
      this.send({ type: 'user', auth: this.userCredentials });
      this.reconnectedSubject.next();
    }
  }

  protected onError(error: Error): void {
    this.osmiumService.trackDebug({ name: 'clob_ws-error', metadata: { message: error.message, type: 'user' } });
  }

  protected onClose(code: number, reason: string): void {
    this.osmiumService.trackDebug({ name: 'clob_ws-closed', metadata: { code, reason, type: 'user' } });
  }

  public authenticate(userCredentials: UserCredentials) {
    this.userCredentials = userCredentials;
    this.send({ type: 'user', auth: this.userCredentials });
    this.logger.debug('User WebSocket authenticated');
  }
}
