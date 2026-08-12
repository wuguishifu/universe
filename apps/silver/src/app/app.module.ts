import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { ConverterModule } from '../modules/converter/converter.module';
import { AppController } from './app.controller';

@Module({
  imports: [EnvironmentModule, ConverterModule],
  controllers: [AppController],
})
export class AppModule {}
