import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { AxiosService } from '@libs/nest-common';
import { TrackingEvent } from '@platform/analytics-contracts';
import { TRACKING_CONFIG } from './constants';

type TrackEventParams = Omit<TrackingEvent, 'timestamp' | 'source'> & {
  timestamp?: number;
};
type QueuedEvent = TrackingEvent & { _retries: number };

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);
  private readonly httpService: AxiosService;

  private eventsQueue: QueuedEvent[] = [];
  private eventQueueInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(TRACKING_CONFIG) private readonly config: TrackingConfig,
  ) {
    this.httpService = new AxiosService({
      baseURL: `${this.config.analyticsServiceBaseUrl}/api/tracking`,
      headers: {
        Authorization: `Bearer ${this.config.analyticsServiceApiKey}`,
      },
    });
  }

  private readonly BATCH_SIZE = 500;
  private readonly MAX_QUEUE_SIZE = 10_000;
  private readonly MAX_RETRIES = 3;

  onModuleInit() {
    if (!this.config.enableBatching) {
      return;
    }

    this.eventQueueInterval = setInterval(() => {
      const currentEvents = this.eventsQueue;
      this.eventsQueue = [];
      if (currentEvents.length === 0) {
        return;
      }

      // chunk into batches to avoid exceeding body size limits
      for (let i = 0; i < currentEvents.length; i += this.BATCH_SIZE) {
        const chunk = currentEvents.slice(i, i + this.BATCH_SIZE);
        const payload = chunk.map(({ _retries: _, ...event }) => event);
        this.httpService.post('/events/batch', payload).catch((error) => {
          this.logger.warn(`Failed to send tracking events: ${error.message}`);
          const toRequeue = chunk
            .map((e) => ({ ...e, _retries: e._retries + 1 }))
            .filter((e) => {
              if (e._retries >= this.MAX_RETRIES) {
                this.logger.warn(
                  `Dropping event "${e.name}" after ${this.MAX_RETRIES} failed attempts`,
                );
                return false;
              }
              return true;
            });
          const combined = toRequeue.concat(this.eventsQueue);
          if (combined.length > this.MAX_QUEUE_SIZE) {
            this.logger.warn(
              `queue exceeded ${this.MAX_QUEUE_SIZE} events, dropping ${combined.length - this.MAX_QUEUE_SIZE} oldest`,
            );
          }
          this.eventsQueue = combined.slice(-this.MAX_QUEUE_SIZE);
        });
      }
    }, 5000);
  }

  onModuleDestroy() {
    if (this.eventQueueInterval) {
      clearInterval(this.eventQueueInterval);
      this.eventQueueInterval = null;
    }
    if (this.eventsQueue.length > 0) {
      const payload = this.eventsQueue.map(
        ({ _retries: _, ...event }) => event,
      );
      this.httpService.post('/events/batch', payload).catch((error) => {
        this.logger.warn(
          `Failed to send tracking events on shutdown: ${error.message}`,
        );
      });
    }
  }

  public trackEvent(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      source: this.config.serviceName,
      timestamp: params.timestamp ?? Date.now(),
    };
    this.dispatchEvent(event);
  }

  private dispatchEvent(event: TrackingEvent) {
    if (this.config.enableBatching) {
      this.eventsQueue.push({ ...event, _retries: 0 });
    } else {
      this.httpService.post('/events', event).catch((error) => {
        this.logger.warn(`Failed to send tracking event: ${error.message}`);
      });
    }
  }
}
