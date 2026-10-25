import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

import {
  NOTIFICATIONS_QUEUE_CONFIG,
  type NotificationJobData,
  type NotificationsQueue,
} from '@platform/notifications-contracts';

import { type NotificationTransport } from './notification-transport';

const QUEUE = NOTIFICATIONS_QUEUE_CONFIG.send;

@Injectable()
export class QueueTransport implements NotificationTransport {
  constructor(
    @InjectQueue(QUEUE.queueName)
    private readonly queue: NotificationsQueue<'send'>,
  ) {}

  public async enqueue(
    data: NotificationJobData,
    idempotencyKey?: string,
  ): Promise<string> {
    const job = await this.queue.add(QUEUE.jobName, data, {
      jobId: idempotencyKey,
    });
    if (!job.id) {
      throw new Error('Notification job was added without an ID');
    }
    return job.id;
  }
}
