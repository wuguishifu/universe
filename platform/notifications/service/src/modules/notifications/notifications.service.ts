import { Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATIONS_QUEUE_CONFIG,
  type NotificationJobData,
  type NotificationsQueue,
} from '@platform/notifications-contracts';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_QUEUE_CONFIG.send.queueName)
    private readonly sendQueue: NotificationsQueue<'send'>,
  ) {}

  /** Adding the same `idempotencyKey` again returns the job already queued with it. */
  public async enqueue(
    data: NotificationJobData,
    idempotencyKey?: string,
  ): Promise<string> {
    const job = await this.sendQueue.add(
      NOTIFICATIONS_QUEUE_CONFIG.send.jobName,
      data,
      { jobId: idempotencyKey },
    );
    if (!job.id) {
      throw new Error('Notification job was added without an ID');
    }
    return job.id;
  }
}
