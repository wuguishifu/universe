import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { thermoSettings } from '@platform/postgres-db';
import type {
  Settings,
  UpdateSettings,
} from '@projects/thermo-automation-contracts';

const toSettings = ({
  locationId,
  timezone,
  displayUnit,
}: typeof thermoSettings.$inferSelect): Settings => ({
  locationId,
  timezone,
  displayUnit,
});

/** The single settings row, created with the defaults the first time it's read. */
@Injectable()
export class SettingsService {
  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  public async get(): Promise<Settings> {
    const [row] = await this.db
      .select()
      .from(thermoSettings)
      .where(eq(thermoSettings.id, 1));
    if (row) return toSettings(row);

    const [created] = await this.db
      .insert(thermoSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    return created ? toSettings(created) : this.get();
  }

  public async update(patch: UpdateSettings): Promise<Settings> {
    if (Object.keys(patch).length === 0) return this.get();
    const [row] = await this.db
      .insert(thermoSettings)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: thermoSettings.id, set: patch })
      .returning();
    if (!row) throw new Error('Saving settings returned no row');
    return toSettings(row);
  }
}
