import { Inject, Injectable, Logger } from '@nestjs/common';
import { osmiumSchema } from '@wuguishifu/db-hydrogen';

import { TrackingEvent } from '@wuguishifu/contracts-osmium';
import { HYDROGEN_DB, HydrogenDb } from '@wuguishifu/nest-common';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(@Inject(HYDROGEN_DB) private readonly hydrogen: HydrogenDb) {}

  public async trackEvent(event: TrackingEvent) {
    this.logger.debug(`Tracking event received: ${event.name}`);
    const cleanedEvent = { ...event, createdAt: new Date(event.createdAt) };
    await this.hydrogen.insert(osmiumSchema.events).values([cleanedEvent]);
  }

  public async trackEventBatch(events: TrackingEvent[]) {
    this.logger.debug(`Tracking batch of ${events.length} events`);
    const cleanedEvents = events.map((event) => ({ ...event, createdAt: new Date(event.createdAt) }));
    await this.hydrogen.insert(osmiumSchema.events).values(cleanedEvents);
  }
}
