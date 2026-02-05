import { Inject, Injectable } from '@nestjs/common';
import { TrackingEvent } from '@wuguishifu/contracts-osmium';

import { OSMIUM_CONFIG } from '../../constants';
import { ConfigService } from '../config.service';
import { HttpService } from '../http.service';

type TrackEventParams = Omit<TrackingEvent, 'createdAt' | 'source'>;

export type OsmiumConfig = {
  serviceName: string;
};

@Injectable()
export class OsmiumService {
  private readonly http: HttpService;

  constructor(
    @Inject(OSMIUM_CONFIG) private readonly config: OsmiumConfig,
    private readonly configService: ConfigService,
  ) {
    this.http = new HttpService({
      baseURL: 'http://localhost:3001/api/v1/tracking',
      headers: {
        Authorization: `Bearer ${this.configService.config.osmium.apiAccessKey}`,
      },
    });
  }

  /** Fire and forget event tracking */
  public trackEvent(params: TrackEventParams) {
    const event: TrackingEvent = {
      ...params,
      source: this.config.serviceName,
      createdAt: Date.now(),
    };
    this.http.post('/events', event);
  }
}
