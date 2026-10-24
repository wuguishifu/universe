import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { TrackingService } from '@platform/analytics-client-nest';
import {
  type ControlAction,
  decide,
  houseClock,
  type Reading,
} from '@projects/thermo-automation-contracts';

import { EnvironmentService } from '../../config/environment';
import { DaikinService, describeError } from '../daikin/daikin.service';
import type { DaikinDeviceInfo, DaikinLocation } from '../daikin/daikin.types';

import { AutomationsService } from './automations.service';
import { DeviceStatesService } from './device-states.service';
import { type HouseDevice, LiveService } from './live.service';
import { SettingsService } from './settings.service';
import { StatusRecordsService } from './status-records.service';

export const toReading = (info: DaikinDeviceInfo, readAt: Date): Reading => ({
  mode: info.mode,
  modeLimit: info.modeLimit,
  equipmentStatus: info.equipmentStatus,
  heatSetpointC: info.heatSetpoint,
  coolSetpointC: info.coolSetpoint,
  setpointDeltaC: info.setpointDelta,
  setpointMinimumC: info.setpointMinimum,
  setpointMaximumC: info.setpointMaximum,
  indoorTemperatureC: info.tempIndoor,
  indoorHumidity: info.humIndoor,
  outdoorTemperatureC: info.tempOutdoor,
  outdoorHumidity: info.humOutdoor,
  readAt: readAt.toISOString(),
});

/**
 * Every few minutes: read each thermostat once, record what it reported, then run the
 * automations against that same reading.
 */
@Injectable()
export class TickService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TickService.name);
  /** Settles when the last queued task (a tick or a manual write) is done. */
  private queue: Promise<void> = Promise.resolve();
  private queuedTick: Promise<void> | null = null;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly trackingService: TrackingService,
    private readonly daikinService: DaikinService,
    private readonly settingsService: SettingsService,
    private readonly automationsService: AutomationsService,
    private readonly deviceStatesService: DeviceStatesService,
    private readonly statusRecordsService: StatusRecordsService,
    private readonly liveService: LiveService,
  ) {}

  onApplicationBootstrap() {
    const intervalMs =
      this.environmentService.environment.tickIntervalMinutes * 60_000;
    // Registered so ScheduleModule clears it on shutdown.
    this.schedulerRegistry.addInterval(
      'tick',
      setInterval(() => void this.run(), intervalMs),
    );
    void this.run();
  }

  /**
   * Runs a tick as soon as nothing else is running. A call during a tick queues another for when
   * it ends, so a settings change mid-tick is still picked up. Calls while one is queued share it.
   */
  public run(): Promise<void> {
    this.queuedTick ??= this.exclusive(() => {
      this.queuedTick = null;
      return this.tick();
    });
    return this.queuedTick;
  }

  /**
   * Runs `task` once the running tick or task is done, and holds off ticks until it is. A tick
   * acting on a reading taken before a manual write would undo it.
   */
  public exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async tick(): Promise<void> {
    const startedAt = new Date();
    let locationId: string | null = null;
    let errors: string[];
    try {
      ({ locationId, errors } = await this.controlHouse(startedAt));
    } catch (error) {
      errors = [describeError(error)];
    }

    this.liveService.recordTick(startedAt, errors);
    if (errors.length > 0) {
      this.logger.warn(`Tick failed:\n${errors.join('\n')}`);
      this.trackingService.trackEvent({
        name: 'thermo_automation-tick_failed',
        properties: {
          locationId,
          consecutiveFailures: this.liveService.getStatus().consecutiveFailures,
        },
        extra: { errors },
      });
    }

    try {
      await this.liveService.publish();
    } catch (error) {
      this.logger.error(`Couldn't publish a snapshot: ${describeError(error)}`);
    }
  }

  /** Returns the problems that didn't stop the tick, such as one device failing to read. */
  private async controlHouse(
    now: Date,
  ): Promise<{ locationId: string | null; errors: string[] }> {
    const errors: string[] = [];
    const settings = await this.settingsService.get();
    const locations = await this.daikinService.getLocations();

    const locationId =
      settings.locationId ?? (await this.pickOnlyLocation(locations));
    if (!locationId) {
      // Nothing to do until a location is picked in the settings.
      return { locationId: null, errors };
    }

    const location = locations.find(
      ({ locationName }) => locationName === locationId,
    );
    if (!location) {
      throw new Error(`Location "${locationId}" isn't on the Daikin account`);
    }

    const devices: HouseDevice[] = await Promise.all(
      location.devices.map(async ({ id, name, model }) => {
        try {
          const info = await this.daikinService.getDeviceInfo(id);
          return {
            id,
            name,
            model,
            reading: toReading(info, now),
            readError: null,
            actionError: null,
          };
        } catch (error) {
          const message = `${name}: ${describeError(error)}`;
          errors.push(message);
          return {
            id,
            name,
            model,
            reading: null,
            readError: message,
            actionError: null,
          };
        }
      }),
    );

    try {
      await this.statusRecordsService.insert(
        devices.flatMap(({ id, reading }) =>
          reading ? [this.toStatusRecord(locationId, id, reading, now)] : [],
        ),
      );
    } catch (error) {
      errors.push(`Recording statuses: ${describeError(error)}`);
    }

    const [automations, deviceStates] = await Promise.all([
      this.automationsService.list(locationId),
      this.deviceStatesService.list(locationId),
    ]);
    const clock = houseClock(now, settings.timezone);

    await Promise.all(
      devices.map(async (device) => {
        if (!device.reading) return;
        const reading = device.reading;
        const state = deviceStates.get(device.id);
        const decision = decide({
          reading,
          rules: automations.filter(
            ({ deviceId, enabled }) => deviceId === device.id && enabled,
          ),
          clock,
          paused: !!state?.pausedUntil && state.pausedUntil > now,
          wasInWindow: state?.wasInWindow ?? false,
        });

        if (decision.action) {
          try {
            await this.apply(locationId, device, reading, decision.action, {
              automationIds: decision.activeRuleIds,
            });
          } catch (error) {
            device.actionError = describeError(error);
            errors.push(`${device.name}: ${device.actionError}`);
            // wasInWindow stays as it was, so a missed window end is retried next tick.
            return;
          }
        }

        try {
          if ((state?.wasInWindow ?? false) !== decision.inWindow) {
            await this.deviceStatesService.setWasInWindow(
              locationId,
              device.id,
              decision.inWindow,
            );
          }
        } catch (error) {
          errors.push(`${device.name}: ${describeError(error)}`);
        }
      }),
    );

    this.liveService.setHouse(locationId, devices);
    return { locationId, errors };
  }

  /** Auto-picks the location when the account has exactly one. */
  private async pickOnlyLocation(
    locations: DaikinLocation[],
  ): Promise<string | null> {
    const [only, ...others] = locations;
    if (!only || others.length > 0) return null;
    await this.settingsService.update({ locationId: only.locationName });
    this.logger.log(
      `Picked the account's only location, "${only.locationName}"`,
    );
    return only.locationName;
  }

  /** Updates the device's cached reading to what was written, so snapshots show it. */
  private async apply(
    locationId: string,
    device: HouseDevice,
    before: Reading,
    action: ControlAction,
    { automationIds }: { automationIds: number[] },
  ): Promise<void> {
    await this.daikinService.setMode(device.id, action);
    device.reading = {
      ...before,
      mode: action.mode,
      heatSetpointC: action.heatSetpointC,
      coolSetpointC: action.coolSetpointC,
    };

    this.logger.log(
      `${device.name}: ${action.kind} (mode ${before.mode} → ${action.mode}, ` +
        `${action.heatSetpointC}–${action.coolSetpointC} °C, at ${before.indoorTemperatureC} °C)`,
    );
    this.trackingService.trackEvent({
      name: 'thermo_automation-action',
      properties: {
        locationId,
        deviceId: device.id,
        action: action.kind,
        mode: action.mode,
      },
      extra: {
        previousMode: before.mode,
        heatSetpointC: action.heatSetpointC,
        coolSetpointC: action.coolSetpointC,
        previousHeatSetpointC: before.heatSetpointC,
        previousCoolSetpointC: before.coolSetpointC,
        indoorTemperatureC: before.indoorTemperatureC,
        automationIds,
      },
    });
  }

  private toStatusRecord(
    locationId: string,
    deviceId: string,
    reading: Reading,
    recordedAt: Date,
  ) {
    return {
      locationId,
      deviceId,
      recordedAt,
      mode: reading.mode,
      equipmentStatus: reading.equipmentStatus,
      heatSetpointC: reading.heatSetpointC,
      coolSetpointC: reading.coolSetpointC,
      indoorTemperatureC: reading.indoorTemperatureC,
      indoorHumidity: reading.indoorHumidity,
      outdoorTemperatureC: reading.outdoorTemperatureC,
      outdoorHumidity: reading.outdoorHumidity,
    };
  }
}
