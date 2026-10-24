import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { thermoDeviceStates } from '@platform/postgres-db';

export type DeviceState = {
  pausedUntil: Date | null;
  wasInWindow: boolean;
};

/** What the app remembers about each device between ticks. */
@Injectable()
export class DeviceStatesService {
  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  /** Keyed by device ID. Devices without a row haven't been paused or seen in a window. */
  public async list(locationId: string): Promise<Map<string, DeviceState>> {
    const rows = await this.db
      .select()
      .from(thermoDeviceStates)
      .where(eq(thermoDeviceStates.locationId, locationId));
    return new Map(
      rows.map(({ deviceId, pausedUntil, wasInWindow }) => [
        deviceId,
        { pausedUntil, wasInWindow },
      ]),
    );
  }

  public async setWasInWindow(
    locationId: string,
    deviceId: string,
    wasInWindow: boolean,
  ): Promise<void> {
    await this.upsert(locationId, deviceId, { wasInWindow });
  }

  /** Null resumes. */
  public async setPausedUntil(
    locationId: string,
    deviceId: string,
    pausedUntil: Date | null,
  ): Promise<void> {
    await this.upsert(locationId, deviceId, { pausedUntil });
  }

  private async upsert(
    locationId: string,
    deviceId: string,
    values: Partial<DeviceState>,
  ): Promise<void> {
    await this.db
      .insert(thermoDeviceStates)
      .values({ locationId, deviceId, ...values })
      .onConflictDoUpdate({
        target: [thermoDeviceStates.locationId, thermoDeviceStates.deviceId],
        set: values,
      });
  }
}
