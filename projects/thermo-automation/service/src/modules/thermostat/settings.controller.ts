import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { thermoRootRouter } from '@projects/thermo-automation-contracts';

import { DaikinService } from '../daikin/daikin.service';

import { LiveService } from './live.service';
import { SettingsService } from './settings.service';
import { TickService } from './tick.service';

@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly daikinService: DaikinService,
    private readonly liveService: LiveService,
    private readonly tickService: TickService,
  ) {}

  @TsRestHandler(thermoRootRouter.settings)
  public handler() {
    return tsRestHandler(thermoRootRouter.settings, {
      get: async () => ({
        status: 200,
        body: await this.settingsService.get(),
      }),
      update: async ({ body }) => {
        const current = await this.settingsService.get();
        const switching =
          body.locationId !== undefined &&
          body.locationId !== current.locationId;

        if (switching) {
          const locations = await this.daikinService.getLocations();
          if (
            !locations.some(
              ({ locationName }) => locationName === body.locationId,
            )
          ) {
            return {
              status: 400,
              body: {
                message: `Location "${body.locationId}" isn't on the Daikin account`,
              },
            };
          }
        }

        const settings = await this.settingsService.update(body);
        if (switching) {
          this.liveService.clearHouse();
          void this.tickService.run();
        }
        await this.liveService.publish();
        return { status: 200, body: settings };
      },
      locations: async () => {
        const locations = await this.daikinService.getLocations();
        return {
          status: 200,
          body: locations.map(({ locationName, devices }) => ({
            id: locationName,
            devices: devices.map(({ id, name }) => ({ id, name })),
          })),
        };
      },
    });
  }
}
