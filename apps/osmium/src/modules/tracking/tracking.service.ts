import { Inject, Injectable, Logger } from '@nestjs/common';

import { TrackingEvent } from '@universe/contracts-osmium';
import { osmiumSchema } from '@universe/db-pluto';
import { PLUTO_DB, type PlutoDb } from '@universe/nest-common';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(@Inject(PLUTO_DB) private readonly pluto: PlutoDb) {}

  public async trackEvent(event: TrackingEvent) {
    this.logger.debug(`Tracking event received: ${event.name}`);
    await this.pluto
      .insert(osmiumSchema.events)
      .values([this.prepareEvent(event)]);
  }

  public async trackEventBatch(events: TrackingEvent[]) {
    this.logger.debug(`Tracking batch of ${events.length} events`);
    await this.pluto
      .insert(osmiumSchema.events)
      .values(events.map(this.prepareEvent));
  }

  private prepareEvent = (
    event: TrackingEvent,
  ): typeof osmiumSchema.events.$inferInsert => {
    return { metadata: {}, ...event, createdAt: new Date(event.createdAt) };
  };
}
