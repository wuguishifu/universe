import { Module } from '@nestjs/common';
import { TrackingModule } from '@platform/analytics-client-nest';
import { EnvironmentModule, EnvironmentService } from '../environment';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        serviceName: 'internet-monitor/service',
        enableBatching: true,
        analyticsServiceBaseUrl: env.environment.analyticsServiceBaseUrl,
        analyticsServiceApiKey: env.environment.analyticsServiceApiToken,
      }),
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
