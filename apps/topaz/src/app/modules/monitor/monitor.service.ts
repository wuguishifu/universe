import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EnvironmentService } from '../../../environment/environment-service';
import { type ServiceConfig } from './watch-config.schema';
import { WatchConfigService } from './watch-config.service';

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly lastKnownStatus = new Map<string, 'ok' | 'down'>();

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly watchConfigService: WatchConfigService,
  ) {}

  onModuleInit() {
    for (const service of this.watchConfigService.getServices()) {
      void this.checkService(service);
      const timer = setInterval(
        () => void this.checkService(service),
        service.interval * 1000,
      );
      this.timers.push(timer);
    }
  }

  onModuleDestroy() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  }

  private async checkService(service: ServiceConfig): Promise<void> {
    const status = await this.probe(service);
    const previous = this.lastKnownStatus.get(service.name);
    if (status === previous) return;
    this.lastKnownStatus.set(service.name, status);
    this.logger.log(`${service.name}: ${previous ?? 'unknown'} -> ${status}`);
    await this.reportStatus(service.name, status);
  }

  private async probe(service: ServiceConfig): Promise<'ok' | 'down'> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), service.timeout);

    try {
      const response = await fetch(service.url, {
        method: service.method,
        signal: controller.signal,
      });
      return response.status === service.expectedStatus ? 'ok' : 'down';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async reportStatus(
    serviceName: string,
    status: 'ok' | 'down',
  ): Promise<void> {
    const { convexSiteUrl } = this.environmentService.environment;

    try {
      const response = await fetch(`${convexSiteUrl}/topaz/report-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.environmentService.environment.convexAdminToken}`,
        },
        body: JSON.stringify({ serviceName, status }),
      });

      if (!response.ok) {
        this.logger.error(
          `Failed to report ${serviceName} status: HTTP ${response.status}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to report ${serviceName} status`, error);
    }
  }
}
