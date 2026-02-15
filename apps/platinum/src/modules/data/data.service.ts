import { Injectable } from '@nestjs/common';

import { HttpService, OsmiumService } from '@wuguishifu/nest-common';

import { DATA_API_BASE } from '../../constants';
import { EnvironmentService } from '../../environment/environment-service';
import { Position, positionSchema } from '../../types/position';

@Injectable()
export class DataService {
  private readonly dataApi = new HttpService({ baseURL: DATA_API_BASE });

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly osmiumService: OsmiumService,
  ) {}

  public async getUserPositions({ callSource }: { callSource: string }): Promise<Position[]> {
    const { data } = await this.dataApi.get(`/positions?user=${this.environmentService.environment.userAddress}`);
    const parsed = positionSchema.array().safeParse(data);

    if (!parsed.success) {
      if (this.environmentService.environment.enableVerboseEvents) {
        this.osmiumService.trackDebug({
          name: 'data_service-get_user_positions_parse_error',
          metadata: {
            callSource,
            error: parsed.error,
            rawData: data,
          },
        });
      }
      return [];
    }

    if (this.environmentService.environment.enableVerboseEvents) {
      this.osmiumService.trackDebug({
        name: 'data_service-get_user_positions',
        metadata: {
          callSource,
          positionCount: parsed.data.length,
        },
      });
    }
    return parsed.data;
  }
}
