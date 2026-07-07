import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { AppController } from './app.controller';
import { FileModule } from './modules/file/file.module';

@Module({
  imports: [EnvironmentModule, FileModule],
  controllers: [AppController],
})
export class AppModule {}
