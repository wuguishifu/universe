import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { BEARER_GUARD } from '../../config/constants';

@Injectable()
export class BearerAuthGuard extends AuthGuard(BEARER_GUARD) {}
