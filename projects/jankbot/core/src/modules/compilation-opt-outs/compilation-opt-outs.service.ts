import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-universe-db';
import { TrackingService } from '@platform/analytics-client-nest';
import { jankbotSchema } from '@platform/postgres-db';

const { userPreferences } = jankbotSchema;

@Injectable()
export class CompilationOptOutsService {
  constructor(
    @Inject(UNIVERSE_DB) private readonly universeDb: UniverseDb,
    private readonly trackingService: TrackingService,
  ) {}

  async optOut(userId: string): Promise<boolean> {
    const changed = await this.universeDb
      .insert(userPreferences)
      .values({ userId, excludeFromCompilations: true })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { excludeFromCompilations: true },
        setWhere: eq(userPreferences.excludeFromCompilations, false),
      })
      .returning({ userId: userPreferences.userId });
    if (changed.length === 0) return false;
    this.trackingService.trackEvent({
      name: 'compilation_opt_out-added',
      properties: { userId },
    });
    return true;
  }

  async optIn(userId: string): Promise<boolean> {
    const changed = await this.universeDb
      .insert(userPreferences)
      .values({ userId, excludeFromCompilations: false })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { excludeFromCompilations: false },
        setWhere: eq(userPreferences.excludeFromCompilations, true),
      })
      .returning({ userId: userPreferences.userId });
    if (changed.length === 0) return false;
    this.trackingService.trackEvent({
      name: 'compilation_opt_out-removed',
      properties: { userId },
    });
    return true;
  }
}
