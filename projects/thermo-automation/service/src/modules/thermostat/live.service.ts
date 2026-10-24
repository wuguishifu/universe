import { Injectable } from '@nestjs/common';
import { BehaviorSubject, filter, type Observable } from 'rxjs';

import {
  decide,
  type DeviceSnapshot,
  houseClock,
  type Reading,
  type Snapshot,
  type TickStatus,
} from '@projects/thermo-automation-contracts';

import { EnvironmentService } from '../../config/environment';

import { AutomationsService } from './automations.service';
import { type DeviceState, DeviceStatesService } from './device-states.service';
import { SettingsService } from './settings.service';

export type HouseDevice = {
  id: string;
  name: string;
  model: string;
  /** The last successful read, with any action the app took since applied to it. */
  reading: Reading | null;
  readError: string | null;
  /** Why the last tick's write to the thermostat failed, if it did. */
  actionError: string | null;
};

/**
 * Holds what the last tick saw and publishes snapshots of it for /api/stream. Snapshots are
 * rebuilt from the DB each time, so they also reflect edits made between ticks.
 */
@Injectable()
export class LiveService {
  private house: { locationId: string; devices: HouseDevice[] } | null = null;
  private status: TickStatus;
  private readonly snapshots = new BehaviorSubject<Snapshot | null>(null);

  /** The latest snapshot straight away, then every new one. */
  public readonly snapshot$: Observable<Snapshot> = this.snapshots.pipe(
    filter((snapshot): snapshot is Snapshot => snapshot !== null),
  );

  constructor(
    environmentService: EnvironmentService,
    private readonly settingsService: SettingsService,
    private readonly automationsService: AutomationsService,
    private readonly deviceStatesService: DeviceStatesService,
  ) {
    this.status = {
      lastTickAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      tickIntervalMs:
        environmentService.environment.tickIntervalMinutes * 60_000,
    };
  }

  public setHouse(locationId: string, devices: HouseDevice[]): void {
    this.house = { locationId, devices };
  }

  /**
   * After a manual write, so snapshots show it before the next tick reads it back. The last tick's
   * action error was about a different attempt, so it's dropped.
   */
  public recordManualChange(deviceId: string, reading: Reading): void {
    const device = this.house?.devices.find(({ id }) => id === deviceId);
    if (device) {
      device.reading = reading;
      device.actionError = null;
    }
  }

  /** After switching location, until the next tick reads the new house. */
  public clearHouse(): void {
    this.house = null;
  }

  /**
   * Whether the last tick saw this device at this location. Unlike `knowsDevice`, an empty cache is
   * a no.
   */
  public hasDevice(locationId: string, deviceId: string): boolean {
    return (
      this.house?.locationId === locationId &&
      this.house.devices.some(({ id }) => id === deviceId)
    );
  }

  /** Whether the last tick saw this device. Before the first tick, any device is accepted. */
  public knowsDevice(deviceId: string): boolean {
    return !this.house || this.house.devices.some(({ id }) => id === deviceId);
  }

  public recordTick(at: Date, errors: string[]): void {
    const failed = errors.length > 0;
    this.status = {
      ...this.status,
      lastTickAt: at.toISOString(),
      lastSuccessAt: failed ? this.status.lastSuccessAt : at.toISOString(),
      lastError: failed ? errors.join('\n') : null,
      consecutiveFailures: failed ? this.status.consecutiveFailures + 1 : 0,
    };
  }

  public getStatus(): TickStatus {
    return this.status;
  }

  public async publish(): Promise<Snapshot> {
    const snapshot = await this.build();
    this.snapshots.next(snapshot);
    return snapshot;
  }

  public async build(): Promise<Snapshot> {
    const settings = await this.settingsService.get();
    const { locationId } = settings;
    const house =
      locationId && this.house?.locationId === locationId ? this.house : null;

    const [automations, deviceStates] = locationId
      ? await Promise.all([
          this.automationsService.list(locationId),
          this.deviceStatesService.list(locationId),
        ])
      : [[], new Map<string, DeviceState>()];

    const now = new Date();
    const clock = houseClock(now, settings.timezone);

    const devices = (house?.devices ?? []).map(
      ({
        id,
        name,
        model,
        reading,
        readError,
        actionError,
      }): DeviceSnapshot => {
        const pausedUntil = deviceStates.get(id)?.pausedUntil ?? null;
        const paused = pausedUntil !== null && pausedUntil > now;
        const decision = reading
          ? decide({
              reading,
              rules: automations.filter(
                (automation) =>
                  automation.deviceId === id && automation.enabled,
              ),
              clock,
              paused,
              wasInWindow: deviceStates.get(id)?.wasInWindow ?? false,
            })
          : null;
        return {
          id,
          name,
          model,
          reading,
          readError,
          pausedUntil: paused ? pausedUntil.toISOString() : null,
          state: decision?.state ?? null,
          // Successful actions are applied to the cached reading, so one that's still called for
          // failed, or is new since the last tick.
          pendingAction: decision?.action?.kind ?? null,
          actionError: decision?.action ? actionError : null,
          inWindow: decision?.inWindow ?? false,
          activeAutomationIds: decision?.activeRuleIds ?? [],
          target: decision?.target ?? null,
        };
      },
    );

    return {
      settings,
      devices,
      automations,
      status: this.status,
      generatedAt: now.toISOString(),
    };
  }
}
