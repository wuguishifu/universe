import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController, LocalEnvironmentModule } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';
import { environmentSchema } from './environment/environment-schema';
import { EnvironmentService } from './environment/environment-service';
import { CacheModule } from './modules/cache/cache.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { GateModule } from './modules/gate/gate.module';
import { PriceModule } from './modules/price/price.module';

@Module({
  imports: [
    CommonModule,
    DiscoveryModule,
    CacheModule,
    PriceModule,
    GateModule,
    LocalEnvironmentModule.forRoot({ schema: environmentSchema }),
  ],
  controllers: [AppController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    EnvironmentService,
  ],
  exports: [EnvironmentService, GateModule],
})
export class AppModule {}
