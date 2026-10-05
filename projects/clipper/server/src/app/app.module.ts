import { Module } from '@nestjs/common';
import { S3Module } from '@libs/nest-common';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    UploadsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
