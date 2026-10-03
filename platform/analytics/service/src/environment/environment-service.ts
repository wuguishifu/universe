import { Injectable } from '@nestjs/common';
import { LocalEnvironmentService } from '@libs/nest-common';
import { environmentSchema } from './environment-schema';

@Injectable()
export class EnvironmentService extends LocalEnvironmentService<
  typeof environmentSchema
> {}
