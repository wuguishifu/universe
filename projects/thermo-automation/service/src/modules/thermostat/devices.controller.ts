import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { thermoRootRouter } from '@projects/thermo-automation-contracts';

import { DeviceStatesService } from './device-states.service';
import { LiveService } from './live.service';
import { SettingsService } from './settings.service';
import { StatusRecordsService } from './status-records.service';

@Controller()
export class DevicesController {
  constructor(
    private readonly deviceStatesService: DeviceStatesService,
    private readonly statusRecordsService: StatusRecordsService,
    private readonly settingsService: SettingsService,
    private readonly liveService: LiveService,
  ) {}

  @TsRestHandler(thermoRootRouter.devices)
  public handler() {
    return tsRestHandler(thermoRootRouter.devices, {
      pause: async ({ params: { deviceId }, body }) => {
        const { locationId } = await this.settingsService.get();
        if (!locationId) {
          return {
            status: 400,
            body: { message: 'Pick a location in the settings first' },
          };
        }
        const until = new Date(body.until);
        if (until <= new Date()) {
          return {
            status: 400,
            body: { message: 'Pause until a time in the future' },
          };
        }
        await this.deviceStatesService.setPausedUntil(
          locationId,
          deviceId,
          until,
        );
        await this.liveService.publish();
        return { status: 200, body: { pausedUntil: until.toISOString() } };
      },
      resume: async ({ params: { deviceId } }) => {
        const { locationId } = await this.settingsService.get();
        if (locationId) {
          await this.deviceStatesService.setPausedUntil(
            locationId,
            deviceId,
            null,
          );
          await this.liveService.publish();
        }
        return { status: 204, body: undefined };
      },
      history: async ({ params: { deviceId }, query: { hours } }) => {
        const { locationId } = await this.settingsService.get();
        const since = new Date(Date.now() - hours * 3_600_000);
        return {
          status: 200,
          body: locationId
            ? await this.statusRecordsService.history(
                locationId,
                deviceId,
                since,
              )
            : [],
        };
      },
    });
  }
}
