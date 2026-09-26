import { Global, Module } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { TungstenService } from './tungsten.service';

@Global()
@Module({
  providers: [ConvexService, TungstenService],
  exports: [ConvexService, TungstenService],
})
export class CommonModule {}
