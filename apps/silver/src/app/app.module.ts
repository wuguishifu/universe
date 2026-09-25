import { Module } from '@nestjs/common';
import { S3Module } from '@universe/nest-common';
import { EnvironmentModule } from '../environment/environment-module';
import { EnvironmentService } from '../environment/environment-service';
import { CommonModule } from '../modules/common/common.module';
import { ConverterModule } from '../modules/converter/converter.module';
import { UrlModule } from '../modules/url/url.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    ConverterModule,
    UrlModule,
    QueueModule,
    CommonModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
