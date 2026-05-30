import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { EnvironmentModule } from './environment/environment-module';

@Module({
  imports: [EnvironmentModule],
  controllers: [AppController],
})
export class AppModule {}
