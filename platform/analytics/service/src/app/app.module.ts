import { Module } from '@nestjs/common';
import { UniverseDbModule } from '@libs/nest-common';
import { EnvironmentModule } from '../environment/environment-module';
import { TrackingModule } from '../modules/tracking/tracking.module';
import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, TrackingModule, UniverseDbModule.register()],
  controllers: [AppController],
})
export class AppModule {}
