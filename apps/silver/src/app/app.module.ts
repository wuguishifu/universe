import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule],
  controllers: [AppController],
})
export class AppModule {}
