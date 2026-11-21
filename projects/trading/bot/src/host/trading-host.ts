import {
  Bar,
  calendarFromDays,
  EngineEvent,
  MarketCalendar,
  MINUTE_MS,
  nyTime,
  OrderIntent,
  OrderUpdate,
  parseStrategyConfig,
  Position,
  SessionHours,
  StrategyConfig,
  StrategyConfigInput,
  TradingEngine,
} from '@projects/trading-core';

import { checkAccount } from './account-rules';
import { BarFeed } from './bar-feed';
import { SnapshotChainProvider } from './chain-provider';
import { DayLedger } from './day-ledger';
import { addDays, nyEpoch } from './ny-clock';
import { OrderTracker } from './order-tracker';
import { OrderWorker } from './order-worker';
import {
  BarSource,
  Broker,
  BrokerOrder,
  Log,
  MarketData,
  OptionQuoteSnapshot,
  Recorder,
  Timers,
} from './ports';
import { missedExit, planReconcile } from './reconcile';
import { HostSettings } from './settings';

export type TradingHostDeps = {
  /** Unique per process. Starts every client order id, so ids never repeat across restarts. */
  runId: string;
  strategy: StrategyConfigInput;
  settings: HostSettings;
  broker: Broker;
  data: MarketData;
  recorder: Recorder;
  timers: Timers;
  log: Log;
  /** Live: poll quotes for held contracts and watch for stale data. The replay drives both itself. */
  live: boolean;
};

const EXTENDED_OPEN = 240; // 04:00
const EXTENDED_CLOSE = 1200; // 20:00
const DRIFT_CHECK_MS = 5 * MINUTE_MS;
/** Every client order id the bot sends starts with this, whichever run sent it. */
export const BOT_ORDER_PREFIX = 'tb-';

/**
 * Hosts one trading day of the engine: warms it up, reconciles what the broker holds, feeds it
 * bars and quotes, places what it asks for and records everything. A new host (and engine) is
 * made each trading day; nothing is meant to be held overnight, and anything that is comes back
 * through reconciliation and is closed by the strategy's flat-before-close rule at the open.
 */
export class TradingHost {
  readonly tracker = new OrderTracker();
  readonly config: StrategyConfig;
  private readonly deps: TradingHostDeps;
  private readonly worker: OrderWorker;
  private readonly ticker: string;
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly quotes = new Map<string, OptionQuoteSnapshot>();
  /** Positions saved this run with the ask their entry was decided on. */
  private readonly entryRefs = new Map<string, number>();
  /** Positions as last saved, to mark them closed. */
  private readonly saved = new Map<string, Position>();
  private engine: TradingEngine | undefined;
  private calendar: MarketCalendar | undefined;
  private hours: SessionHours | undefined;
  private feed: BarFeed | undefined;
  private ledger: DayLedger | undefined;
  private date = '';
  private entryBlockers: string[] = [];
  private stopping = false;
  private urgent = false;
  private loopsRunning = false;
  private flattenSeq = 0;
  private lastDriftCheck = 0;
  private reconcilePasses = 0;
  /** Set by the app to make the bar stream reconnect when the watchdog finds it stale. */
  onStale: (() => void) | undefined;

  constructor(deps: TradingHostDeps) {
    this.deps = deps;
    this.config = parseStrategyConfig(deps.strategy);
    const [ticker] = this.config.tickers;
    if (!ticker || this.config.tickers.length !== 1)
      throw new Error('The bot trades exactly one ticker');
    this.ticker = ticker;
    if (!deps.runId.startsWith(BOT_ORDER_PREFIX))
      throw new Error(`Run ids must start with ${BOT_ORDER_PREFIX}`);
    this.worker = new OrderWorker({
      broker: deps.broker,
      tracker: this.tracker,
      timers: deps.timers,
      settings: deps.settings,
      log: deps.log,
      onOrder: ({ intent, attempt, order, submittedAt, quote }) =>
        deps.recorder.order({
          runId: deps.runId,
          intentId: intent.id,
          attempt,
          order,
          submittedAt,
          quoteAtSubmit: quote,
        }),
    });
  }

  get tradingDate(): string {
    return this.date;
  }

  get sessionHours(): SessionHours | undefined {
    return this.hours;
  }

  get positions(): Position[] {
    return this.engine?.getPositions() ?? [];
  }

  get barStats() {
    return this.feed?.stats;
  }

  get blockers(): readonly string[] {
    return this.entryBlockers;
  }

  // --- the day ---------------------------------------------------------------------------------

  /** Everything before the first live bar. Call at `prepareAt` or later on a trading day. */
  async prepare(date: string): Promise<void> {
    const { data, broker, recorder, settings, log, runId } = this.deps;
    this.date = date;

    const days = await data.calendar(addDays(date, -60), addDays(date, 14));
    this.calendar = calendarFromDays(days);
    const hours = this.calendar.regularHours(date);
    if (!hours) throw new Error(`${date} is not a trading day`);
    this.hours = hours;

    this.ledger = new DayLedger({
      date,
      runId,
      stockFeed: settings.stockFeed,
      optionsFeed: settings.optionsFeed,
      feePerContract: settings.feePerContract,
    });

    const account = await broker.getAccount();
    const check = checkAccount(account);
    this.entryBlockers = check.blockers;
    this.ledger.account = { ...account, raw: undefined, check };
    for (const warning of check.warnings) log.warn('account', { warning });
    for (const blocker of check.blockers) {
      log.error('no entries today', { blocker });
      this.incident('accountBlocksEntries', { blocker });
    }

    this.engine = new TradingEngine({
      config: this.config,
      calendar: this.calendar,
      // Each day's engine counts orders from 1 again, so the date keeps ids unique within a run.
      orderIdPrefix: `${runId}-${date.slice(2).replaceAll('-', '')}-`,
      chains: new SnapshotChainProvider(data, settings, (request, quotes) =>
        recorder.chain(runId, settings.optionsFeed, request, quotes),
      ),
    });
    this.engine.setEquity(account.equity);

    // Warmup: earlier trading days, then today up to the last closed minute.
    const earlier = days
      .map((day) => day.date)
      .filter((d) => d < date)
      .slice(-settings.warmupDays);
    for (const day of earlier) {
      const bars = await data.stockBars(
        this.ticker,
        nyEpoch(day, EXTENDED_OPEN),
        nyEpoch(day, EXTENDED_CLOSE),
      );
      if (bars.length === 0) log.warn('no warmup bars', { day });
      await this.engine.warmup(this.ticker, bars);
    }
    const now = this.deps.timers.now();
    const lastClosed = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const todayStart = nyEpoch(date, EXTENDED_OPEN);
    const today =
      lastClosed > todayStart
        ? await data.stockBars(this.ticker, todayStart, lastClosed)
        : [];
    for (const bar of today)
      recorder.bar(this.ticker, settings.stockFeed, bar, 'warmup');
    await this.engine.warmup(this.ticker, today);
    log.info('warmed up', {
      date,
      days: earlier.length,
      todayBars: today.length,
    });

    this.feed = new BarFeed({
      ticker: this.ticker,
      fetchBars: (start, end) => data.stockBars(this.ticker, start, end),
      deliver: (bar, source) => this.deliver(bar, source),
      log,
      now: () => this.deps.timers.now(),
    });
    this.feed.startAfter(today.at(-1)?.time ?? todayStart - MINUTE_MS);

    await this.reconcile(today);
    this.writeDay();
  }

  /** Starts the live loops (quote polling, watchdog). A no-op for the replay. */
  start(): void {
    if (!this.deps.live || this.loopsRunning) return;
    this.loopsRunning = true;
    void this.loop('quotes', this.deps.settings.quotePollMs, () =>
      this.pollQuotes(),
    );
    void this.loop('watchdog', 30_000, () => this.watchdog());
  }

  /** Ends the day: stops the loops, waits for orders in flight and writes the day record. */
  async endDay(): Promise<void> {
    this.loopsRunning = false;
    await this.idle();
    this.writeDay();
    await this.deps.recorder.flush();
  }

  /**
   * Gets flat for a shutdown: no new entries, entries in flight canceled, every position sold
   * with exits going straight to market. Options only trade in regular hours; outside them the
   * positions are left for the next run to reconcile.
   */
  async shutdown(reason: string): Promise<void> {
    const { log, timers, settings } = this.deps;
    this.stopping = true;
    this.urgent = true;
    this.incident('shutdown', { reason, positions: this.positions.length });
    const engine = this.engine;
    if (engine && this.positions.length > 0) {
      if (this.marketOpen(timers.now())) {
        this.handle(await engine.closeAll(timers.now()));
      } else {
        log.warn('market closed: positions left for the next run', {
          positions: this.positions.map((p) => p.contract.symbol),
        });
        this.incident('shutdownWhileClosed', { positions: this.positions });
      }
    }
    const deadline = timers.now() + settings.shutdownFlattenTimeoutMs;
    while (this.inflight.size > 0 && timers.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...this.inflight]),
        timers.sleep(1_000),
      ]);
    }
    if (this.inflight.size > 0) {
      log.error('shutdown timed out with orders still working', {
        positions: this.positions,
      });
      this.incident('shutdownTimedOut', { positions: this.positions });
    }
    await this.endDay();
  }

  /** Resolves once no order is being worked. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  // --- inputs ----------------------------------------------------------------------------------

  /** A 1-minute bar from the stream. */
  onStreamBar(bar: Bar): Promise<void> {
    if (!this.feed) return Promise.resolve();
    return this.feed.push(bar);
  }

  /** The stream revised a bar the engine already used. Kept for the record only. */
  onBarCorrection(bar: Bar): void {
    this.ledger?.count('barCorrections');
    this.deps.recorder.barCorrection(
      this.ticker,
      this.deps.settings.stockFeed,
      bar,
    );
  }

  /** A quote for an option contract. */
  async onQuote(quote: OptionQuoteSnapshot): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.quotes.set(quote.symbol, quote);
    this.handle(
      await engine.onQuote({
        symbol: quote.symbol,
        time: quote.time,
        bid: quote.bid,
        ask: quote.ask,
      }),
    );
  }

  /** An order report from the trade-update stream. */
  onTradeUpdate(
    event: string,
    order: BrokerOrder,
    time: number,
    payload: unknown,
  ): void {
    this.tracker.update(order);
    this.deps.recorder.tradeUpdate(
      this.deps.runId,
      order.clientOrderId,
      event,
      time,
      payload,
    );
  }

  /** A stream connected, dropped or reconnected. */
  onStreamStatus(
    stream: string,
    status: string,
    details: Record<string, unknown> = {},
  ): void {
    this.ledger?.count(`${stream}:${status}`);
    if (status !== 'connected')
      this.incident(`stream:${status}`, { stream, ...details });
    if (stream === 'bars' && status === 'connected' && this.feed) {
      void this.feed.catchUp();
    }
  }

  // --- engine plumbing -------------------------------------------------------------------------

  private async deliver(bar: Bar, source: BarSource): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const { recorder, settings, timers } = this.deps;
    recorder.bar(this.ticker, settings.stockFeed, bar, source);
    this.ledger?.count(`bars:${this.sessionPart(bar.time)}`);
    if (source === 'backfill') this.ledger?.count('barsBackfilled');
    this.handle(await engine.onBar(this.ticker, bar));

    // Backstop: whatever the strategy's own flat rule did, nothing is held into the close.
    const hours = this.hours;
    const minute = nyTime(bar.time + MINUTE_MS).minute;
    if (
      hours &&
      minute >= hours.close - settings.backstopMinutesBeforeClose &&
      minute < hours.close &&
      this.positions.some((p) => p.status === 'open')
    ) {
      this.incident('backstopFlatten', { positions: this.positions });
      this.urgent = true;
      this.handle(await engine.closeAll(timers.now()));
    }
  }

  private handle(events: readonly EngineEvent[]): void {
    const { recorder, runId, log, timers } = this.deps;
    for (const event of events) {
      const time = eventTime(event) ?? timers.now();
      recorder.engineEvent(runId, time, event);
      if (event.type === 'bar') log.debug('bar', { snapshot: event.snapshot });
      else log.info(`engine ${event.type}`, { event });

      const trade = this.ledger?.onEvent(event);
      if (trade) recorder.trade(trade);

      switch (event.type) {
        case 'order':
          this.onOrderIntent(event.order);
          break;
        case 'positionOpened':
          this.save(event.position, 'open');
          break;
        case 'exitFailed': {
          const held = this.positions.find(
            (p) => p.contract.symbol === event.trade?.symbol,
          );
          if (held) this.save(held, 'open');
          this.incident('exitFailed', { event });
          break;
        }
        case 'positionClosed': {
          const position = this.saved.get(event.trade.positionId);
          if (position)
            recorder.savePosition({ runId, status: 'closed', position });
          this.saved.delete(event.trade.positionId);
          break;
        }
        case 'entryFailed':
          this.incident('entryFailed', { event });
          break;
      }
      if (event.type !== 'bar') this.writeDay();
    }
  }

  private onOrderIntent(intent: OrderIntent): void {
    const { timers } = this.deps;
    if (intent.action === 'open') {
      const position = this.positions.find((p) => p.id === intent.positionId);
      this.entryRefs.set(intent.positionId, intent.refPrice);
      if (position) this.save(position, 'opening');

      const blocker = this.stopping ? 'shutting down' : this.entryBlockers[0];
      if (blocker) {
        this.ledger?.blocked(intent.id, blocker);
        this.incident('entryBlocked', { intent, blocker });
        this.track(
          this.report({
            orderId: intent.id,
            status: 'canceled',
            filledQty: 0,
            avgFillPrice: 0,
            time: timers.now(),
          }),
        );
        return;
      }
    }

    const now = timers.now();
    let notBefore: number | undefined;
    if (!this.marketOpen(now)) {
      const open = this.openTime();
      if (open !== undefined && now < open) {
        notBefore = open;
      } else {
        // After the close: leave the position closing; tomorrow's run reconciles it.
        this.incident('exitHeldMarketClosed', { intent });
        return;
      }
    }

    this.track(
      this.worker.work(intent, (update) => this.report(update), {
        notBefore,
        // Shutting down cancels entries; exits are what shutting down is for.
        abort: intent.action === 'open' ? () => this.stopping : undefined,
        urgent: () => this.urgent,
        quote: () => this.quotes.get(intent.symbol),
      }),
    );
  }

  private async report(update: OrderUpdate): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.handle(await engine.onOrderUpdate(update));
    if (update.status !== 'partiallyFilled') this.refreshEquity();
  }

  private refreshEquity(): void {
    this.track(
      this.deps.broker
        .getAccount()
        .then((account) => this.engine?.setEquity(account.equity)),
    );
  }

  // --- restart ---------------------------------------------------------------------------------

  private async reconcile(today: readonly Bar[]): Promise<void> {
    const { broker, recorder, log } = this.deps;
    const engine = this.engine;
    if (!engine || !this.calendar) return;

    const [brokerPositions, openOrders, saved] = await Promise.all([
      broker.listPositions(),
      broker.listOpenOrders(),
      recorder.loadOpenPositions(),
    ]);
    const plan = planReconcile({
      tickers: this.config.tickers,
      clientOrderPrefix: BOT_ORDER_PREFIX,
      brokerPositions,
      openOrders,
      saved,
    });

    for (const order of plan.cancel) {
      log.warn('canceling an order left by an earlier run', {
        clientOrderId: order.clientOrderId,
      });
      try {
        await broker.cancelOrder(order.id);
      } catch (error) {
        log.warn('cancel failed', {
          clientOrderId: order.clientOrderId,
          error: String(error),
        });
      }
    }
    if (plan.cancel.length > 0) {
      // Fills may land between the listing and the cancel; read the positions again.
      return this.reconcileAgain(today, plan.cancel.length);
    }

    for (const item of plan.foreign) this.incident('foreignHolding', { item });
    for (const gone of plan.gone) {
      recorder.savePosition({ ...gone, status: 'closed' });
      this.incident('savedPositionGone', { position: gone.position });
    }
    for (const position of plan.restore) {
      const missed = missedExit(
        position,
        today,
        this.config.exits,
        this.calendar,
      );
      const ref = saved.find(
        (s) => s.position.id === position.id,
      )?.entryRefPrice;
      if (missed) {
        this.incident('missedExitWhileDown', {
          position,
          reason: missed.reason,
          bar: missed.bar,
        });
        this.flattenOutside(
          position.contract.symbol,
          position.qty,
          `missed ${missed.reason} while down`,
        );
        continue;
      }
      await engine.restorePosition(position);
      if (ref !== undefined) this.entryRefs.set(position.id, ref);
      this.ledger?.restored(position.id, ref);
      this.ledger?.count('restored');
      this.save(position, 'open');
      this.incident('restored', { position });
      log.warn('restored a position from an earlier run', { position });
    }
    for (const item of plan.flatten) {
      this.incident('unexplainedHolding', item);
      this.flattenOutside(item.symbol, item.qty, item.reason);
    }
    if (plan.restore.length + plan.flatten.length === 0)
      log.info('nothing to reconcile');
  }

  private async reconcileAgain(
    today: readonly Bar[],
    canceled: number,
  ): Promise<void> {
    this.reconcilePasses += 1;
    if (this.reconcilePasses > 3)
      throw new Error('Orders keep appearing during reconciliation');
    this.deps.log.info('re-reading positions after canceling', { canceled });
    await this.deps.timers.sleep(2_000);
    return this.reconcile(today);
  }

  /** Sells a holding the engine doesn't manage, at the first chance the market is open. */
  private flattenOutside(symbol: string, qty: number, reason: string): void {
    const { timers, runId } = this.deps;
    this.flattenSeq += 1;
    this.ledger?.count('flattenedOutsideEngine');
    const intent: OrderIntent = {
      id: `${runId}-${this.date.slice(2).replaceAll('-', '')}-x${this.flattenSeq}`,
      action: 'close',
      positionId: 'unmanaged',
      ticker: this.ticker,
      symbol,
      side: 'sell',
      qty,
      refPrice: this.quotes.get(symbol)?.bid ?? 0,
      time: timers.now(),
      reason: 'forced',
    };
    const now = timers.now();
    const open = this.openTime();
    const notBefore =
      !this.marketOpen(now) && open !== undefined && now < open
        ? open
        : undefined;
    if (!this.marketOpen(now) && notBefore === undefined) {
      this.incident('flattenHeldMarketClosed', { symbol, qty, reason });
      return;
    }
    this.track(
      this.worker.work(
        intent,
        (update) => {
          if (update.status !== 'partiallyFilled')
            this.incident('flattenedOutsideEngine', {
              symbol,
              qty,
              reason,
              update,
            });
          return Promise.resolve();
        },
        {
          notBefore,
          urgent: () => this.urgent,
          quote: () => this.quotes.get(symbol),
        },
      ),
    );
  }

  // --- live loops ------------------------------------------------------------------------------

  private async loop(
    name: string,
    everyMs: number,
    task: () => Promise<void>,
  ): Promise<void> {
    while (this.loopsRunning) {
      try {
        await task();
      } catch (error) {
        this.deps.log.warn(`${name} loop failed`, { error: String(error) });
      }
      await this.deps.timers.sleep(everyMs);
    }
  }

  private async pollQuotes(): Promise<void> {
    const symbols = new Set(this.positions.map((p) => p.contract.symbol));
    if (symbols.size === 0) return;
    const quotes = await this.deps.data.latestOptionQuotes([...symbols]);
    for (const quote of quotes) {
      const known = this.quotes.get(quote.symbol);
      if (
        known &&
        known.time === quote.time &&
        known.bid === quote.bid &&
        known.ask === quote.ask
      )
        continue;
      this.deps.recorder.quote(
        this.deps.runId,
        this.deps.settings.optionsFeed,
        quote,
      );
      await this.onQuote(quote);
    }
  }

  private async watchdog(): Promise<void> {
    const { timers, settings, log } = this.deps;
    const feed = this.feed;
    const engine = this.engine;
    if (!feed || !engine) return;
    const now = timers.now();
    const { date, minute } = nyTime(now);
    if (
      date !== this.date ||
      minute < EXTENDED_OPEN ||
      minute >= EXTENDED_CLOSE
    )
      return;

    const regular = this.marketOpen(now);
    const limit = regular ? settings.staleBarMs : settings.staleBarExtendedMs;
    const lastSeen = feed.stats.lastReceivedAt ?? feed.stats.lastBarTime ?? 0;
    if (now - lastSeen > limit) {
      this.ledger?.count('staleChecks');
      log.warn('bars are stale; backfilling', {
        lastSeen: new Date(lastSeen).toISOString(),
      });
      this.incident('staleBars', { lastSeen, regular });
      await feed.catchUp();
      this.onStale?.();
    }

    const lastBar = feed.stats.lastBarTime ?? 0;
    const holding = this.positions.some((p) => p.status === 'open');
    if (
      regular &&
      holding &&
      now - (lastBar + MINUTE_MS) > settings.staleFlattenMs
    ) {
      this.incident('staleFlatten', { lastBar, positions: this.positions });
      log.error('no bars while holding; flattening', {
        lastBar: new Date(lastBar).toISOString(),
      });
      this.urgent = true;
      this.handle(await engine.closeAll(now));
    }

    if (
      regular &&
      now - this.lastDriftCheck > DRIFT_CHECK_MS &&
      this.inflight.size === 0
    ) {
      this.lastDriftCheck = now;
      await this.checkDrift();
    }
  }

  /** The broker holding more of a contract than the engine knows about (a late fill, a manual trade). */
  private async checkDrift(): Promise<void> {
    if (this.positions.some((p) => p.status !== 'open')) return;
    const held = await this.deps.broker.listPositions();
    for (const position of held) {
      if (
        position.assetClass !== 'us_option' ||
        !position.symbol.startsWith(this.ticker)
      )
        continue;
      const known = this.positions
        .filter((p) => p.contract.symbol === position.symbol)
        .reduce((sum, p) => sum + p.qty, 0);
      const extra = position.qty - known;
      if (extra > 0) {
        this.incident('drift', {
          symbol: position.symbol,
          broker: position.qty,
          engine: known,
        });
        this.flattenOutside(
          position.symbol,
          extra,
          'held more than the engine knows about',
        );
      }
    }
  }

  // --- helpers ---------------------------------------------------------------------------------

  private save(position: Position, status: 'opening' | 'open'): void {
    this.deps.recorder.savePosition({
      runId: this.deps.runId,
      status,
      position,
      entryRefPrice: this.entryRefs.get(position.id),
    });
    this.saved.set(position.id, position);
  }

  private marketOpen(time: number): boolean {
    const hours = this.hours;
    if (!hours) return false;
    const { date, minute } = nyTime(time);
    return date === this.date && minute >= hours.open && minute < hours.close;
  }

  private openTime(): number | undefined {
    return this.hours ? nyEpoch(this.date, this.hours.open) : undefined;
  }

  private sessionPart(time: number): string {
    const minute = nyTime(time).minute;
    const hours = this.hours;
    if (!hours || minute < hours.open) return 'premarket';
    return minute < hours.close ? 'regular' : 'after';
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => {
      this.deps.log.error('order handling failed', { error: String(error) });
      this.incident('orderHandlingFailed', { error: String(error) });
    });
    this.inflight.add(tracked);
    void tracked.finally(() => this.inflight.delete(tracked));
  }

  private incident(kind: string, details: unknown): void {
    this.deps.recorder.incident(
      this.deps.runId,
      this.deps.timers.now(),
      kind,
      details,
    );
  }

  private writeDay(): void {
    const ledger = this.ledger;
    if (!ledger) return;
    this.deps.recorder.day(
      ledger.toRecord({
        bars: this.feed?.stats,
        entryBlockers: this.entryBlockers,
      }),
    );
  }
}

function eventTime(event: EngineEvent): number | undefined {
  switch (event.type) {
    case 'bar':
      return event.snapshot.bar.time;
    case 'signal':
    case 'entrySkipped':
      return event.time;
    case 'order':
      return event.order.time;
    case 'positionOpened':
      return event.position.entryTime;
    case 'positionClosed':
      return event.trade.exitTime;
    default:
      return undefined;
  }
}
