import { Module } from '@nestjs/common';

import { KubernetesClient } from './kubernetes.client';
import { SyncService } from './sync.service';
import { TraefikClient } from './traefik.client';

@Module({
  providers: [SyncService, TraefikClient, KubernetesClient],
  exports: [SyncService],
})
export class SyncModule {}
