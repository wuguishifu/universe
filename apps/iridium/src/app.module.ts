import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController, LocalEnvironmentModule } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';
import { environmentSchema } from './environment/environment-schema';
import { EnvironmentService } from './environment/environment-service';
import { CacheModule } from './modules/cache/cache.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { PriceModule } from './modules/price/price.module';

@Module({
  imports: [
    CommonModule,
    DiscoveryModule,
    CacheModule,
    PriceModule,
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
  exports: [EnvironmentService],
})
export class AppModule {}
