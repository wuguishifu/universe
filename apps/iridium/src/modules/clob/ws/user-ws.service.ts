import { Injectable, Logger } from '@nestjs/common';
import { Data } from 'ws';

import { WebSocketService } from './ws-service';
import { CLOB_USER_WS_URL } from '../../../constants/constants';

type UserCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

@Injectable()
export class UserWsService extends WebSocketService {
  protected readonly logger = new Logger(UserWsService.name);
  private userCredentials: UserCredentials | null = null;

  constructor() {
    super(CLOB_USER_WS_URL);
  }

  protected handleMessage(data: Data): void {
    this.logger.debug(`User WS message: ${data.toString()}`);
  }

  public authenticate(userCredentials: UserCredentials) {
    this.userCredentials = userCredentials;
    this.send({ type: 'user', auth: this.userCredentials });
  }
}
