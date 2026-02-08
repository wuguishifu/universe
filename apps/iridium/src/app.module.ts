import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AllExceptionsFilter, CommonModule, HealthController, OsmiumModule } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';
import { OSMIUM_SERVICE } from './constants/constants';
import { EnvironmentModule } from './environment/environment-module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { StrategyModule } from './modules/strategy/strategy.module';

@Module({
  imports: [
    CommonModule,
    DiscoveryModule,
    StrategyModule,
    EnvironmentModule,
    OsmiumModule.register({ serviceName: 'iridium' }, OSMIUM_SERVICE),
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
