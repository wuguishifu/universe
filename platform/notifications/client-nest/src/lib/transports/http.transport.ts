import { Inject, Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { HttpService } from '@libs/http';
import { type NotificationJobData } from '@platform/notifications-contracts';

import { type NotificationsTransportConfig } from '../config';
import { NOTIFICATIONS_CLIENT_CONFIG } from '../constants';

import { type NotificationTransport } from './notification-transport';

@Injectable()
export class HttpTransport implements NotificationTransport {
  private readonly httpService: HttpService;

  constructor(
    @Inject(NOTIFICATIONS_CLIENT_CONFIG)
    config: NotificationsTransportConfig<'http'>,
  ) {
    // Retries network errors and 5xx/429 with exponential backoff.
    this.httpService = new HttpService({
      baseURL: `${config.baseUrl}/api`,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
    });
  }

  public async enqueue(
    data: NotificationJobData,
    // Always sent, so a retried request whose first attempt did get through isn't queued twice.
    idempotencyKey: string = randomUUID(),
  ): Promise<string> {
    const response = await this.httpService.post<{ jobId: string }>(
      '/notifications',
      { ...data, idempotencyKey },
    );
    return response.data.jobId;
  }
}
