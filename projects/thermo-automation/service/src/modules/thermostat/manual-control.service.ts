import { Injectable, Logger } from '@nestjs/common';

import { TrackingService } from '@platform/analytics-client-nest';
import {
  type DisplayUnit,
  type ManualControl,
  manualControlProblem,
} from '@projects/thermo-automation-contracts';

import { DaikinService } from '../daikin/daikin.service';

import { LiveService } from './live.service';
import { SettingsService } from './settings.service';
import { TickService, toReading } from './tick.service';

const formatTemperature = (celsius: number, unit: DisplayUnit) => {
  const value = unit === 'F' ? celsius * 1.8 + 32 : celsius;
  return `${Math.round(value * 10) / 10}°${unit}`;
};

/** Mode and setpoint changes made by hand from the page. */
@Injectable()
export class ManualControlService {
  private readonly logger = new Logger(ManualControlService.name);

  constructor(
    private readonly trackingService: TrackingService,
    private readonly daikinService: DaikinService,
    private readonly settingsService: SettingsService,
    private readonly tickService: TickService,
    private readonly liveService: LiveService,
  ) {}

  /**
   * Merges `change` into a fresh read of the thermostat, so a field the page didn't change can't
   * undo one made elsewhere since the last tick. Returns why it was refused, or null once written.
   *
   * The thermostat has to be one the last tick saw at the selected location. That's checked in the
   * queue, where a location switch's tick has already filled the cache, so a page still showing the
   * old house can't change it.
   */
  public apply(
    deviceId: string,
    change: ManualControl,
  ): Promise<string | null> {
    return this.tickService.exclusive(async () => {
      const { locationId, displayUnit } = await this.settingsService.get();
      if (!locationId) return 'Pick a location in the settings first';
      if (!this.liveService.hasDevice(locationId, deviceId)) {
        return "That thermostat isn't at this location";
      }

      const info = await this.daikinService.getDeviceInfo(deviceId);
      const before = toReading(info, new Date());
      const problem = manualControlProblem(before, change, (celsius) =>
        formatTemperature(celsius, displayUnit),
      );
      if (problem) return problem;

      const after = {
        mode: change.mode ?? before.mode,
        heatSetpointC: change.heatSetpointC ?? before.heatSetpointC,
        coolSetpointC: change.coolSetpointC ?? before.coolSetpointC,
      };
      await this.daikinService.setMode(deviceId, after);
      this.liveService.recordManualChange(deviceId, { ...before, ...after });

      this.logger.log(
        `${deviceId}: changed by hand (mode ${before.mode} → ${after.mode}, ` +
          `${after.heatSetpointC}–${after.coolSetpointC} °C)`,
      );
      this.trackingService.trackEvent({
        name: 'thermo_automation-manual_change',
        properties: { locationId, deviceId, mode: after.mode },
        extra: {
          previousMode: before.mode,
          heatSetpointC: after.heatSetpointC,
          coolSetpointC: after.coolSetpointC,
          previousHeatSetpointC: before.heatSetpointC,
          previousCoolSetpointC: before.coolSetpointC,
          indoorTemperatureC: before.indoorTemperatureC,
        },
      });
      return null;
    });
  }
}
