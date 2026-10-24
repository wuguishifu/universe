import { Injectable, Logger } from '@nestjs/common';
import {
  BehaviorSubject,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  ignoreElements,
  interval,
  merge,
  type Observable,
  share,
  startWith,
} from 'rxjs';
import type {
  Account,
  Snapshot,
  Transfer,
} from '@projects/mega-client-contracts';
import { AccountService } from './account.service';
import { MegaCliError } from './mega-cli.service';
import { TransfersService } from './transfers.service';

/** How often MEGAcmd is read while anyone has the page open. Nobody watching, no reads. */
const POLL_INTERVAL_MS = 2_000;

const sameContent = (a: Snapshot, b: Snapshot) =>
  JSON.stringify({ ...a, generatedAt: '' }) ===
  JSON.stringify({ ...b, generatedAt: '' });

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads MEGAcmd into snapshots for /api/stream. MEGAcmd has no events, so this polls, but only
 * while at least one client is connected, and only sends snapshots that changed.
 */
@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private readonly snapshots = new BehaviorSubject<Snapshot | null>(null);

  /** A poll and a change can build at the same time: the older build mustn't land last. */
  private buildsStarted = 0;
  private latestPublished = 0;

  /** What a failed read falls back on. */
  private account: Account = { loggedIn: false, email: null };
  private transfers: Transfer[] = [];
  private queuePaused = false;
  private lastError: string | null = null;

  /** Shared, so polling starts with the first client and stops when the last one leaves. */
  private readonly polls$ = interval(POLL_INTERVAL_MS).pipe(
    startWith(0),
    exhaustMap(() => this.publish()),
    ignoreElements(),
    // The next client to connect shouldn't see transfers from whenever the last one left.
    finalize(() => this.snapshots.next(null)),
    share(),
  );

  /** The latest snapshot straight away (if there's a fresh one), then every one that changed. */
  public readonly snapshot$: Observable<Snapshot> = merge(
    this.snapshots.pipe(
      filter((snapshot): snapshot is Snapshot => snapshot !== null),
      distinctUntilChanged(sameContent),
    ),
    this.polls$,
  );

  constructor(
    private readonly accountService: AccountService,
    private readonly transfersService: TransfersService,
  ) {}

  public async publish(): Promise<Snapshot> {
    const build = ++this.buildsStarted;
    const snapshot = await this.build();
    if (build > this.latestPublished) {
      this.latestPublished = build;
      this.snapshots.next(snapshot);
    }
    return snapshot;
  }

  public async build(): Promise<Snapshot> {
    const [account, transfers] = await Promise.allSettled([
      this.accountService.get(),
      this.transfersService.list(),
    ]);
    if (account.status === 'fulfilled') this.account = account.value;
    if (transfers.status === 'fulfilled') {
      this.transfers = transfers.value.transfers;
      this.queuePaused = transfers.value.queuePaused;
    }

    const errors = [account, transfers].flatMap((result) =>
      result.status === 'rejected' ? [messageOf(result.reason)] : [],
    );
    const error = errors.length ? [...new Set(errors)].join('\n') : null;
    // Once per change, not every poll.
    if (error && error !== this.lastError) {
      this.logger.warn(`Couldn't read MEGAcmd: ${error}`);
    }
    this.lastError = error;

    return {
      account: this.account,
      transfers: this.transfers,
      queuePaused: this.queuePaused,
      error,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Runs a change, then publishes and answers with the snapshot it led to. A change MEGAcmd
   * refused goes back as a 400 with what it said.
   */
  public async afterChange(change: () => Promise<unknown>) {
    try {
      await change();
    } catch (error) {
      if (error instanceof MegaCliError) {
        return { status: 400, body: { message: error.message } } as const;
      }
      throw error;
    }
    return { status: 200, body: await this.publish() } as const;
  }
}
