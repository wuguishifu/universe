import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { AppController } from './app.controller';
import { ClipperModule } from './modules/clipper/clipper.module';

@Module({
  imports: [EnvironmentModule, ClipperModule],
  controllers: [AppController],
})
export class AppModule {}
