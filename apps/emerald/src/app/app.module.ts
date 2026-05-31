import { Module } from '@nestjs/common';

import { OsmiumModule } from '@universe/nest-common';

import { OSMIUM_SERVICE } from '../constants';
import { EnvironmentModule } from '../environment/environment-module';
import { ClipperModule } from '../modules/clipper/clipper.module';
import { QueueModule } from '../queues/queue.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    ClipperModule,
    QueueModule,
    OsmiumModule.register(
      { serviceName: 'emerald', enableBatching: true },
      OSMIUM_SERVICE,
    ),
  ],
  controllers: [AppController],
})
export class AppModule {}
