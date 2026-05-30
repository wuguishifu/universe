import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { EnvironmentModule } from './environment/environment-module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';

@Module({
  imports: [EnvironmentModule, OrchestratorModule],
  controllers: [AppController],
})
export class AppModule {}
