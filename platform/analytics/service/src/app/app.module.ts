import { Module } from '@nestjs/common';
import { UniverseDbModule } from '@libs/nest-common';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { TrackingModule } from '../modules/tracking/tracking.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    TrackingModule,
    UniverseDbModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        connectionString: env.environment.universeDbConnectionString,
      }),
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
