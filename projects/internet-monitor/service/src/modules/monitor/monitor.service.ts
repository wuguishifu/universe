import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TrackingService } from '@platform/analytics-client-nest';

const endpoints = ['8.8.8.8', '1.1.1.1'];

@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly trackingService: TrackingService) {}

  onModuleInit() {
    this.interval = setInterval(() => {
      // TODO: check
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}
