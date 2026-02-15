import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, CommonModule, HealthController, OsmiumModule } from '@wuguishifu/nest-common';

import { OSMIUM_SERVICE } from './constants';
import { EnvironmentModule } from './environment/environment-module';
import { LiquidatorModule } from './modules/liquidator/liquidator.module';

@Module({
  imports: [
    CommonModule,
    EnvironmentModule,
    OsmiumModule.register({ serviceName: 'platinum' }, OSMIUM_SERVICE),
    LiquidatorModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
