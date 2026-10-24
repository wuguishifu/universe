import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment';
import { MegaModule } from '../modules/mega/mega.module';
import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, MegaModule],
  controllers: [AppController],
})
export class AppModule {}
