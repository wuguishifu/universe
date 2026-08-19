import { Global, Module } from '@nestjs/common';
import { ConvexClientService } from './convex-client.service';

@Global()
@Module({
  providers: [ConvexClientService],
  exports: [ConvexClientService],
})
export class CommonModule {}
