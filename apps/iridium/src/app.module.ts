import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController } from '@wuguishifu/nest-common';

import { AppController } from './app.controller';
import { EnvironmentModule } from './environment/environment-module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { StrategyModule } from './modules/strategy/strategy.module';

@Module({
  imports: [CommonModule, DiscoveryModule, StrategyModule, EnvironmentModule, LedgerModule],
  controllers: [AppController, HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
