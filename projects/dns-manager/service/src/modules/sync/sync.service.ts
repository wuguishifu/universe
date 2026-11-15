import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  EnvironmentService,
  type EnvironmentSchema,
} from '../../config/environment';

import { KubernetesClient } from './kubernetes.client';
import {
  applyRemovalGrace,
  buildEndpoints,
  diffEndpoints,
  type DnsEndpoint,
  hostsFromRouters,
  type SkippedHost,
} from './records';
import { TraefikClient } from './traefik.client';

export type SyncStatus = {
  dryRun: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  endpoints: DnsEndpoint[];
  skipped: SkippedHost[];
  pendingRemoval: string[];
};

/**
 * Every SYNC_INTERVAL_SECONDS: Traefik routers ─► desired endpoints ─► the DNSEndpoint that
 * external-dns turns into Cloudflare records. Anything going wrong leaves the DNSEndpoint as it
 * is, so an unreachable or empty Traefik never deletes records.
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private readonly environment: EnvironmentSchema;

  private interval?: ReturnType<typeof setInterval>;
  private isSyncing = false;
  private missingSince = new Map<string, number>();
  // What was last written (or, in a dry run, would have been). Dry runs never read the cluster.
  private lastApplied?: DnsEndpoint[];
  private lastSkippedKey = '';
  private status: SyncStatus;

  constructor(
    private readonly traefik: TraefikClient,
    private readonly kubernetes: KubernetesClient,
    environmentService: EnvironmentService,
  ) {
    this.environment = environmentService.environment;
    this.status = {
      dryRun: this.environment.dryRun,
      endpoints: [],
      skipped: [],
      pendingRemoval: [],
    };
  }

  onModuleInit() {
    this.interval = setInterval(
      () => this.sync(),
      this.environment.syncIntervalSeconds * 1000,
    );
    this.sync();
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  private async sync() {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;
    const now = Date.now();
    this.status = {
      ...this.status,
      lastAttemptAt: new Date(now).toISOString(),
    };

    try {
      await this.syncOnce(now);
      this.status = {
        ...this.status,
        lastSuccessAt: new Date(now).toISOString(),
        lastError: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Sync failed, DNS left unchanged: ${message}`);
      this.status = { ...this.status, lastError: message };
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncOnce(now: number) {
    const { dryRun, domain, tailnetTarget, gatewaySuffix, gatewayTarget } =
      this.environment;

    const hosts = hostsFromRouters(await this.traefik.fetchHttpRouters());
    if (hosts.length === 0) {
      // More likely a broken Traefik provider than a NAS with nothing on it.
      throw new Error('Traefik reported no Host() routers');
    }

    const { endpoints: desired, skipped } = buildEndpoints(hosts, {
      domain,
      tailnetTarget,
      gatewaySuffix,
      gatewayTarget,
    });
    this.logSkipped(skipped);

    const current = dryRun
      ? (this.lastApplied ?? [])
      : ((await this.kubernetes.getEndpoints()) ?? []);
    const graced = applyRemovalGrace({
      current,
      desired,
      missingSince: this.missingSince,
      now,
      graceMs: this.environment.removalGraceSeconds * 1000,
    });
    this.missingSince = graced.missingSince;
    this.status = {
      ...this.status,
      endpoints: graced.endpoints,
      skipped,
      pendingRemoval: graced.pendingRemoval,
    };

    const { added, removed, changed } = diffEndpoints(
      current,
      graced.endpoints,
    );
    if (added.length + removed.length + changed.length === 0) {
      this.logger.debug(`No changes (${graced.endpoints.length} records)`);
      return;
    }

    const summary = [
      ...added.map((name) => `+${name}`),
      ...changed.map((name) => `~${name}`),
      ...removed.map((name) => `-${name}`),
    ].join(' ');
    if (dryRun) {
      this.logger.log(`[dry run] Would apply: ${summary}`);
      this.logger.log(JSON.stringify(graced.endpoints, null, 2));
    } else {
      await this.kubernetes.applyEndpoints(graced.endpoints);
      this.logger.log(`Applied: ${summary}`);
    }
    this.lastApplied = graced.endpoints;
  }

  /** Logs skipped hosts only when the list changes, not every sync. */
  private logSkipped(skipped: SkippedHost[]) {
    const key = JSON.stringify(skipped);
    if (key === this.lastSkippedKey) {
      return;
    }
    this.lastSkippedKey = key;
    for (const { host, reason } of skipped) {
      this.logger.warn(`Skipping ${host}: ${reason}`);
    }
  }
}
