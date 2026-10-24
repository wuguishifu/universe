import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisCacheService } from '@libs/nest-common';
import { TrackingService } from '@platform/analytics-client-nest';
import { EnvironmentService } from '../../config/environment';
import { OutageTracker } from './outage-tracker';
import { type Endpoint, isReachable } from './probe';

const internetEndpoints: Endpoint[] = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 },
  { host: '9.9.9.9', port: 443 },
];

const CHECK_INTERVAL_MS = 15_000;
const CHECK_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly gatewayEndpoint: Endpoint;
  private readonly internet: OutageTracker;
  private readonly gateway: OutageTracker;

  private interval?: ReturnType<typeof setInterval>;
  private isChecking = false;
  private lastHeartbeatAt = 0;

  constructor(
    private readonly trackingService: TrackingService,
    cache: RedisCacheService,
    environmentService: EnvironmentService,
  ) {
    const { gatewayHost, gatewayPort } = environmentService.environment;
    this.gatewayEndpoint = { host: gatewayHost, port: gatewayPort };
    this.internet = new OutageTracker('internet', trackingService, cache);
    this.gateway = new OutageTracker('gateway', trackingService, cache);
  }

  async onModuleInit() {
    await Promise.all([this.internet.restore(), this.gateway.restore()]);
    this.interval = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.check();
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private async check() {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;
    try {
      const [internetUp, gatewayUp] = await Promise.all([
        Promise.all(
          internetEndpoints.map((endpoint) =>
            isReachable(endpoint, { timeoutMs: CHECK_TIMEOUT_MS }),
          ),
        ).then((results) => results.some(Boolean)),
        isReachable(this.gatewayEndpoint, {
          timeoutMs: CHECK_TIMEOUT_MS,
          refusedIsReachable: true,
        }),
      ]);
      const now = Date.now();

      await Promise.all([
        this.internet.record(internetUp, now, { gatewayUp }),
        this.gateway.record(gatewayUp, now),
      ]);

      if (now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        this.lastHeartbeatAt = now;
        this.trackingService.trackEvent({
          name: 'internet_monitor-heartbeat',
          timestamp: now,
          properties: {
            internetUp,
            gatewayUp,
            internetOutage: this.internet.isOutage,
            gatewayOutage: this.gateway.isOutage,
          },
        });
      }
    } finally {
      this.isChecking = false;
    }
  }
}
