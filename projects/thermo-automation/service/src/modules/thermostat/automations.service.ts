import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { thermoAutomations } from '@platform/postgres-db';
import type {
  Automation,
  AutomationInput,
} from '@projects/thermo-automation-contracts';

type AutomationRow = typeof thermoAutomations.$inferSelect;

const toAutomation = (row: AutomationRow): Automation => ({
  id: row.id,
  locationId: row.locationId,
  deviceId: row.deviceId,
  daysMask: row.daysMask,
  // Postgres returns HH:MM:SS.
  startsAt: row.startsAt.slice(0, 5),
  endsAt: row.endsAt.slice(0, 5),
  minTemperatureC: row.minTemperatureC,
  maxTemperatureC: row.maxTemperatureC,
  bufferC: row.bufferC,
  enabled: row.enabled,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Every query is scoped to a location, so other houses' automations stay out of the way. */
@Injectable()
export class AutomationsService {
  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  public async list(locationId: string): Promise<Automation[]> {
    const rows = await this.db
      .select()
      .from(thermoAutomations)
      .where(eq(thermoAutomations.locationId, locationId))
      .orderBy(
        asc(thermoAutomations.deviceId),
        asc(thermoAutomations.startsAt),
        asc(thermoAutomations.id),
      );
    return rows.map(toAutomation);
  }

  public async create(
    locationId: string,
    input: AutomationInput,
  ): Promise<Automation> {
    const [row] = await this.db
      .insert(thermoAutomations)
      .values({ locationId, ...input })
      .returning();
    if (!row) throw new Error('Creating an automation returned no row');
    return toAutomation(row);
  }

  /** Null when there's no such automation at the location. */
  public async update(
    locationId: string,
    id: number,
    input: AutomationInput,
  ): Promise<Automation | null> {
    const [row] = await this.db
      .update(thermoAutomations)
      .set(input)
      .where(
        and(
          eq(thermoAutomations.id, id),
          eq(thermoAutomations.locationId, locationId),
        ),
      )
      .returning();
    return row ? toAutomation(row) : null;
  }

  public async remove(locationId: string, id: number): Promise<boolean> {
    const rows = await this.db
      .delete(thermoAutomations)
      .where(
        and(
          eq(thermoAutomations.id, id),
          eq(thermoAutomations.locationId, locationId),
        ),
      )
      .returning({ id: thermoAutomations.id });
    return rows.length > 0;
  }
}
