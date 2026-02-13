import { Injectable } from '@nestjs/common';

import { MarketAdapter } from './adapter';
import { Crypto1hAdapter } from './crypto-1h.adapter';
import { Crypto5mAdapter } from './crypto-5m.adapter';
import { EnvironmentSchema } from '../../environment/environment-schema';
import { EnvironmentService } from '../../environment/environment-service';

const adapterMap: Record<EnvironmentSchema['adapter'], new () => MarketAdapter> = {
  'crypto-1h': Crypto1hAdapter,
  'crypto-5m': Crypto5mAdapter,
};

@Injectable()
export class MarketAdapterService {
  public readonly adapter: MarketAdapter;

  constructor(private readonly environmentService: EnvironmentService) {
    const adapterType = this.environmentService.environment.adapter;
    const AdapterClass = adapterMap[adapterType];
    this.adapter = new AdapterClass();
  }
}
