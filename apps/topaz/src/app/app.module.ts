import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { AppController } from './app.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [EnvironmentModule],
  controllers: [HealthController, AppController],
})
export class AppModule {}
