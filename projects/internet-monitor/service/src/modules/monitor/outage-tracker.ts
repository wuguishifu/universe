import { Logger } from '@nestjs/common';

import { randomUUID } from 'node:crypto';

import { RedisCacheService } from '@libs/nest-redis-cache';
import { TrackingService } from '@platform/analytics-client-nest';

import { type Incident, MONITOR_REDIS } from '../../config/redis-keys';

const FAILURES_BEFORE_OUTAGE = 2;

export type OutageTarget = 'internet' | 'gateway';

type Properties = Record<string, string | number | boolean | null>;

export class OutageTracker {
  private readonly logger: Logger;
  private consecutiveFailures = 0;
  private firstFailureAt?: number;
  private incident?: Incident;
  private restoredIncident = false;

  constructor(
    private readonly target: OutageTarget,
    private readonly trackingService: TrackingService,
    private readonly cache: RedisCacheService,
  ) {
    this.logger = new Logger(`OutageTracker:${target}`);
  }

  get isOutage() {
    return this.incident !== undefined;
  }

  async restore() {
    try {
      this.incident = await this.cache.get({
        key: MONITOR_REDIS.openIncidents,
        id: this.target,
      });
    } catch (error) {
      this.logger.error('failed to restore open incident', error);
    }
    if (this.incident) {
      this.restoredIncident = true;
      this.logger.warn(`restored open incident ${this.incident.id}`);
    }
  }

  async record(reachable: boolean, now: number, properties: Properties = {}) {
    if (reachable) {
      await this.handleUp(now, properties);
    } else {
      await this.handleDown(now, properties);
    }
  }

  private async handleDown(now: number, properties: Properties) {
    this.consecutiveFailures++;
    this.firstFailureAt ??= now;
    if (this.incident || this.consecutiveFailures < FAILURES_BEFORE_OUTAGE) {
      return;
    }

    const incident = { id: randomUUID(), startedAt: this.firstFailureAt };
    this.incident = incident;
    this.logger.warn(`outage detected (incident ${incident.id})`);
    this.trackingService.trackEvent({
      name: `${this.target}_outage-started`,
      timestamp: incident.startedAt,
      properties: { ...properties, reconciliationId: incident.id },
    });
    await this.persist(() =>
      this.cache.set({
        key: MONITOR_REDIS.openIncidents,
        id: this.target,
        value: incident,
      }),
    );
  }

  private async handleUp(now: number, properties: Properties) {
    const incident = this.incident;
    const restoredIncident = this.restoredIncident;
    this.incident = undefined;
    this.restoredIncident = false;
    this.consecutiveFailures = 0;
    this.firstFailureAt = undefined;
    if (!incident) {
      return;
    }

    const durationMs = now - incident.startedAt;
    this.logger.log(
      `restored after ${Math.round(durationMs / 1000)}s (incident ${incident.id})`,
    );
    this.trackingService.trackEvent({
      name: `${this.target}_outage-ended`,
      timestamp: now,
      properties: {
        ...properties,
        reconciliationId: incident.id,
        durationMs,
        restoredIncident,
      },
    });
    await this.persist(() =>
      this.cache.delete({ key: MONITOR_REDIS.openIncidents, id: this.target }),
    );
  }

  private async persist(write: () => Promise<unknown>) {
    try {
      await write();
    } catch (error) {
      this.logger.error('failed to persist open incident', error);
    }
  }
}
