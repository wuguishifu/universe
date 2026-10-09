import { Inject, Injectable, Logger } from '@nestjs/common';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { TrackingEvent } from '@platform/analytics-contracts';
import { publicSchema } from '@platform/postgres-db';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(@Inject(UNIVERSE_DB) private readonly universeDb: UniverseDb) {}

  public async trackEvent(event: TrackingEvent) {
    this.logger.debug(`Tracking event received: ${event.name}`);
    await this.universeDb
      .insert(publicSchema.events)
      .values([this.prepareEvent(event)]);
  }

  public async trackEventBatch(events: TrackingEvent[]) {
    this.logger.debug(`Tracking batch of ${events.length} events`);
    await this.universeDb
      .insert(publicSchema.events)
      .values(events.map(this.prepareEvent));
  }

  private prepareEvent = (
    event: TrackingEvent,
  ): typeof publicSchema.events.$inferInsert => {
    return {
      properties: {},
      extra: {},
      ...event,
      timestamp: new Date(event.timestamp),
    };
  };
}
