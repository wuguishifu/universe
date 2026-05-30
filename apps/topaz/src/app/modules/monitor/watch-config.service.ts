import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parse } from 'yaml';

import { readFileSync } from 'fs';

import { EnvironmentService } from '../../../environment/environment-service';

import { type ServiceConfig, watchConfigSchema } from './watch-config.schema';


@Injectable()
export class WatchConfigService implements OnModuleInit {
  private readonly logger = new Logger(WatchConfigService.name);
  private services: ServiceConfig[] = [];

  constructor(private readonly environmentService: EnvironmentService) {}

  onModuleInit() {
    const { configPath } = this.environmentService.environment;
    this.logger.log(`Loading watch config from ${configPath}`);

    const raw = readFileSync(configPath, 'utf-8');
    const parsed = watchConfigSchema.parse(parse(raw));
    this.services = parsed.services;

    this.logger.log(`Loaded ${this.services.length} service(s) to monitor`);
  }

  getServices(): ServiceConfig[] {
    return this.services;
  }
}
