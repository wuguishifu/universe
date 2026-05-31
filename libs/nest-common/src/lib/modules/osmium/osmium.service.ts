import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { TrackingEvent } from '@universe/contracts-osmium';

import { OSMIUM_CONFIG } from '../../constants';
import { AxiosService } from '../../services/axios.service';

type TrackEventParams = Omit<TrackingEvent, 'createdAt' | 'source'>;
type QueuedEvent = TrackingEvent & { _retries: number };

export type OsmiumConfig = {
  serviceName: string;
  enableBatching?: boolean;
  debugPrefix?: string;
  osmiumBaseUrl: string;
  osmiumApiAccessKey: string;
};

@Injectable()
export class OsmiumService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OsmiumService.name);
  private readonly httpService: AxiosService;

  private eventsQueue: QueuedEvent[] = [];
  private eventQueueInterval: NodeJS.Timeout | null = null;

  constructor(@Inject(OSMIUM_CONFIG) private readonly config: OsmiumConfig) {
    this.httpService = new AxiosService({
      baseURL: `${this.config.osmiumBaseUrl}/api/v1/tracking`,
      headers: {
        Authorization: `Bearer ${this.config.osmiumApiAccessKey}`,
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
          this.logger.warn(
            `Failed to send tracking events to Osmium: ${error.message}`,
          );
          const toRequeue = chunk
            .map((e) => ({ ...e, _retries: e._retries + 1 }))
            .filter((e) => {
              if (e._retries >= this.MAX_RETRIES) {
                this.logger.warn(
                  `Dropping Osmium event "${e.name}" after ${this.MAX_RETRIES} failed attempts`,
                );
                return false;
              }
              return true;
            });
          const combined = toRequeue.concat(this.eventsQueue);
          if (combined.length > this.MAX_QUEUE_SIZE) {
            this.logger.warn(
              `Osmium queue exceeded ${this.MAX_QUEUE_SIZE} events, dropping ${combined.length - this.MAX_QUEUE_SIZE} oldest`,
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
          `Failed to send tracking events to Osmium on shutdown: ${error.message}`,
        );
      });
    }
  }

  public trackEvent(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      source: this.config.serviceName,
      createdAt: Date.now(),
    };
    this.dispatchEvent(event);
  }

  public trackDebug(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      name: this.formatDebugEventName(params.name),
      source: this.config.serviceName,
      createdAt: Date.now(),
    };
    this.dispatchEvent(event);
  }

  private formatDebugEventName(name: string) {
    return `${this.config.debugPrefix ?? 'debug'}-${name}`;
  }

  private dispatchEvent(event: TrackingEvent) {
    if (this.config.enableBatching) {
      this.eventsQueue.push({ ...event, _retries: 0 });
    } else {
      this.httpService.post('/events', event).catch((error) => {
        this.logger.warn(
          `Failed to send tracking event to Osmium: ${error.message}`,
        );
      });
    }
  }
}
