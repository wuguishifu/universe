import { Global, Module } from '@nestjs/common';

import { LocalEnvironmentModule } from '@wuguishifu/nest-common';

import { environmentSchema } from './environment-schema';
import { EnvironmentService } from './environment-service';

@Global()
@Module({
  imports: [LocalEnvironmentModule.forRoot({ schema: environmentSchema })],
  providers: [EnvironmentService],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
