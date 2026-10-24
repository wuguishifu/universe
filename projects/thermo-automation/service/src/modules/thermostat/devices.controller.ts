import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { thermoRootRouter } from '@projects/thermo-automation-contracts';

import { describeError } from '../daikin/daikin.service';

import { DeviceStatesService } from './device-states.service';
import { LiveService } from './live.service';
import { ManualControlService } from './manual-control.service';
import { SettingsService } from './settings.service';
import { StatusRecordsService } from './status-records.service';

@Controller()
export class DevicesController {
  constructor(
    private readonly deviceStatesService: DeviceStatesService,
    private readonly statusRecordsService: StatusRecordsService,
    private readonly settingsService: SettingsService,
    private readonly liveService: LiveService,
    private readonly manualControlService: ManualControlService,
  ) {}

  @TsRestHandler(thermoRootRouter.devices)
  public handler() {
    return tsRestHandler(thermoRootRouter.devices, {
      control: async ({ params: { deviceId }, body }) => {
        let problem: string | null;
        try {
          problem = await this.manualControlService.apply(deviceId, body);
        } catch (error) {
          return { status: 502, body: { message: describeError(error) } };
        }
        if (problem) {
          return { status: 400, body: { message: problem } };
        }
        await this.liveService.publish();
        return { status: 204, body: undefined };
      },
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
