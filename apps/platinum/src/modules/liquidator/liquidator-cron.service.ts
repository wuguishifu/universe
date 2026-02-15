import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { catchError, EMPTY, exhaustMap, from, Subject, takeUntil, timer } from 'rxjs';

import { LiquidatorService } from './liquidator.service';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class LiquidatorCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiquidatorCronService.name);

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly liquidatorService: LiquidatorService,
  ) {}

  onModuleInit() {
    const intervalMs = this.environmentService.environment.liquidationIntervalMs;
    this.logger.log(`Starting liquidation cron. Interval ${intervalMs} ms`);

    timer(0, intervalMs)
      .pipe(
        takeUntil(this.destroy$),
        exhaustMap(() => {
          return from(this.liquidatorService.liquidate()).pipe(
            catchError((error) => {
              this.logger.error('Error during liquidation cycle', error);
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe();
  }

  onModuleDestroy() {
    this.logger.log('Stopping liquidation cron');
    this.destroy$.next();
    this.destroy$.complete();
  }
}
