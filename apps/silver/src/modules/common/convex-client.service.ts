import { Injectable } from '@nestjs/common';
import { ConvexHttpClient } from 'convex/browser';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class ConvexClientService {
  public readonly client: ConvexHttpClient;

  constructor(private readonly environmentService: EnvironmentService) {
    this.client = new ConvexHttpClient(
      this.environmentService.environment.convexUrl,
    );
  }
}
