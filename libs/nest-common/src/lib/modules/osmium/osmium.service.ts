import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TrackingEvent } from '@wuguishifu/contracts-osmium';

import { OSMIUM_CONFIG } from '../../constants';
import { HttpService } from '../../services/http.service';

type TrackEventParams = Omit<TrackingEvent, 'createdAt' | 'source'>;

export type OsmiumConfig = {
  serviceName: string;
  osmiumBaseUrl: string;
  osmiumApiAccessKey: string;
};

@Injectable()
export class OsmiumService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OsmiumService.name);
  private readonly httpService: HttpService;

  private eventsQueue: TrackingEvent[] = [];
  private eventQueueInterval: NodeJS.Timeout | null = null;

  constructor(@Inject(OSMIUM_CONFIG) private readonly config: OsmiumConfig) {
    this.httpService = new HttpService({
      baseURL: `${this.config.osmiumBaseUrl}/api/v1/tracking`,
      headers: {
        Authorization: `Bearer ${this.config.osmiumApiAccessKey}`,
      },
    });
  }

  private readonly BATCH_SIZE = 500;

  onModuleInit() {
    this.eventQueueInterval = setInterval(() => {
      const currentEvents = this.eventsQueue;
      this.eventsQueue = [];
      if (currentEvents.length === 0) {
        return;
      }

      // chunk into batches to avoid exceeding body size limits
      for (let i = 0; i < currentEvents.length; i += this.BATCH_SIZE) {
        const chunk = currentEvents.slice(i, i + this.BATCH_SIZE);
        this.httpService.post('/events/batch', chunk).catch((error) => {
          this.logger.warn(`Failed to send tracking events to Osmium: ${error.message}`);
          this.eventsQueue = chunk.concat(this.eventsQueue);
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
      this.httpService.post('/events/batch', this.eventsQueue).catch((error) => {
        this.logger.warn(`Failed to send tracking events to Osmium on shutdown: ${error.message}`);
      });
    }
  }

  public trackEvent(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      source: this.config.serviceName,
      createdAt: Date.now(),
    };
    this.eventsQueue.push(event);
  }

  public trackDebug(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      name: `debug-${params.name}`,
      source: this.config.serviceName,
      createdAt: Date.now(),
    };
    this.eventsQueue.push(event);
  }
}
