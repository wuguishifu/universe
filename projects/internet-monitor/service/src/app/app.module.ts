import { Module } from '@nestjs/common';
import { RedisCacheModule } from '@libs/nest-common';
import { TrackingModule } from '@platform/analytics-client-nest';
import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { MonitorModule } from '../modules/monitor/monitor.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    RedisCacheModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        url: env.environment.redisUrl,
      }),
    }),
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        serviceName: 'internet-monitor/service',
        enableBatching: true,
        analyticsServiceBaseUrl: env.environment.analyticsServiceBaseUrl,
        analyticsServiceApiKey: env.environment.analyticsServiceApiToken,
      }),
    }),
    MonitorModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
