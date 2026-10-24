import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte } from 'drizzle-orm';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { thermoDeviceStatusRecords } from '@platform/postgres-db';
import type { HistoryPoint } from '@projects/thermo-automation-contracts';

export type StatusRecord = typeof thermoDeviceStatusRecords.$inferInsert;

/** A row per device per tick. Never deleted: longer history is for Redash. */
@Injectable()
export class StatusRecordsService {
  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  public async insert(records: StatusRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.insert(thermoDeviceStatusRecords).values(records);
  }

  public async history(
    locationId: string,
    deviceId: string,
    since: Date,
  ): Promise<HistoryPoint[]> {
    const rows = await this.db
      .select({
        recordedAt: thermoDeviceStatusRecords.recordedAt,
        mode: thermoDeviceStatusRecords.mode,
        equipmentStatus: thermoDeviceStatusRecords.equipmentStatus,
        indoorTemperatureC: thermoDeviceStatusRecords.indoorTemperatureC,
        heatSetpointC: thermoDeviceStatusRecords.heatSetpointC,
        coolSetpointC: thermoDeviceStatusRecords.coolSetpointC,
      })
      .from(thermoDeviceStatusRecords)
      .where(
        and(
          eq(thermoDeviceStatusRecords.deviceId, deviceId),
          gte(thermoDeviceStatusRecords.recordedAt, since),
          eq(thermoDeviceStatusRecords.locationId, locationId),
        ),
      )
      .orderBy(asc(thermoDeviceStatusRecords.recordedAt));
    return rows.map((row) => ({
      ...row,
      recordedAt: row.recordedAt.toISOString(),
    }));
  }
}
