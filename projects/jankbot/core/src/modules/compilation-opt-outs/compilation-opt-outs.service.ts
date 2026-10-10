import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-common';
import { TrackingService } from '@platform/analytics-client-nest';
import { jankbotSchema } from '@platform/postgres-db';

const { compilationOptOuts } = jankbotSchema;

@Injectable()
export class CompilationOptOutsService {
  constructor(
    @Inject(UNIVERSE_DB) private readonly universeDb: UniverseDb,
    private readonly trackingService: TrackingService,
  ) {}

  async optOut(userId: string): Promise<boolean> {
    const inserted = await this.universeDb
      .insert(compilationOptOuts)
      .values({ userId })
      .onConflictDoNothing()
      .returning({ userId: compilationOptOuts.userId });
    if (inserted.length === 0) return false;
    this.trackingService.trackEvent({
      name: 'compilation_opt_out-added',
      properties: { userId },
    });
    return true;
  }

  async optIn(userId: string): Promise<boolean> {
    const deleted = await this.universeDb
      .delete(compilationOptOuts)
      .where(eq(compilationOptOuts.userId, userId))
      .returning({ userId: compilationOptOuts.userId });
    if (deleted.length === 0) return false;
    this.trackingService.trackEvent({
      name: 'compilation_opt_out-removed',
      properties: { userId },
    });
    return true;
  }
}
