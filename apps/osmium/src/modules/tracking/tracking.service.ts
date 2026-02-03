import { Injectable, Logger } from '@nestjs/common';

import { TrackingEvent } from '@wuguishifu/contracts-osmium';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  public async trackEvent(event: TrackingEvent) {
    this.logger.debug(`Tracking event received: ${event.name}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  public async trackEventBatch(events: TrackingEvent[]) {
    this.logger.debug(`Tracking batch of ${events.length} events`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
