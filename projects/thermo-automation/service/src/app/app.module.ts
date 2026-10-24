import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { UniverseDbModule } from '@libs/nest-universe-db';
import { TrackingModule } from '@platform/analytics-client-nest';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { DaikinModule } from '../modules/daikin/daikin.module';
import { ThermostatModule } from '../modules/thermostat/thermostat.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    ScheduleModule.forRoot(),
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        serviceName: 'thermo-automation/service',
        enableBatching: true,
        analyticsServiceBaseUrl:
          environmentService.environment.analyticsServiceBaseUrl,
        analyticsServiceApiKey:
          environmentService.environment.analyticsServiceApiToken,
      }),
    }),
    UniverseDbModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        connectionString: env.environment.universeDbConnectionString,
      }),
    }),
    DaikinModule,
    ThermostatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
