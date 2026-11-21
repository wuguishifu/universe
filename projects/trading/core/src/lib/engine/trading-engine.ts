import {
  parseStrategyConfig,
  StrategyConfig,
  StrategyConfigInput,
} from '../config/strategy-config';
import { ContractSelector } from '../contracts/contract-selector';
import { createExitRule } from '../exits/config';
import { ExitEvent, ExitReason, ExitRule } from '../exits/exit-rule';
import { createEntryFilter } from '../filters/config';
import { EntryContext, EntryFilter, LastExit } from '../filters/entry-filter';
import { createIndicator } from '../indicators/config';
import { Indicator } from '../indicators/indicator';
import { BarAggregator } from '../market/bar-aggregator';
import {
  EXTENDED_HOURS,
  MarketCalendar,
  weekdayCalendar,
} from '../market/calendar';
import { MINUTE_MS, NyTime, nyTime } from '../market/ny-time';
import { Bar, multiplierOf, OptionQuote } from '../market/types';
import { createRiskRule, RiskRule } from '../risk/risk-rules';
import { createSignal } from '../signals/config';
import { SignalGenerator } from '../signals/signal';
import { createPositionSizer, PositionSizer } from '../sizing/position-sizer';
import {
  BarSnapshot,
  Clock,
  Direction,
  optionTypeFor,
  pnlPct,
  Position,
} from '../strategy/types';

import { ChainProvider, EngineEvent, OrderUpdate, Trade } from './types';

export type TradingEngineOptions = {
  config: StrategyConfigInput;
  chains: ChainProvider;
  /** Defaults to every weekday at regular hours. Pass one built from the broker's calendar to get holidays and early closes. */
  calendar?: MarketCalendar;
  /** Starts every order id. Make it unique per run, because brokers reject a reused client order id. */
  orderIdPrefix?: string;
};

type TickerState = {
  ticker: string;
  aggregator: BarAggregator;
  indicators: Array<[name: string, indicator: Indicator]>;
  signal: SignalGenerator;
  sessionDate: string | undefined;
  barIndex: number;
  lastExit: LastExit | undefined;
  entriesDate: string | undefined;
  entriesToday: number;
};

type OrderRef =
  | { action: 'open'; positionId: string }
  | {
      action: 'close';
      positionId: string;
      reason: ExitReason;
      barIndex: number;
    };

/**
 * Runs one strategy config over live or historical data. It never talks to a broker: the host
 * feeds it market data and order updates, and places the orders it asks for.
 *
 * Feed it:
 * - `onBar` with every closed 1-minute bar for each configured ticker.
 * - `onQuote` with quotes for every option it holds. Subscribe when an `open` order goes out.
 * - `onOrderUpdate` with the broker's reports on the orders it asked for.
 *
 * Calls are processed one at a time in the order they were made, so the host doesn't need to wait
 * for one to finish before making the next.
 */
export class TradingEngine {
  readonly config: StrategyConfig;
  private readonly chains: ChainProvider;
  private readonly calendar: MarketCalendar;
  private readonly orderIdPrefix: string;
  private readonly filters: EntryFilter[];
  private readonly exits: ExitRule[];
  private readonly contracts: ContractSelector;
  private readonly sizer: PositionSizer;
  private readonly risk: RiskRule[];
  private readonly tickers = new Map<string, TickerState>();
  private readonly positions = new Map<string, Position>();
  private readonly orders = new Map<string, OrderRef>();
  private readonly trades: Trade[] = [];
  private equity: number | undefined;
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: TradingEngineOptions) {
    this.config = parseStrategyConfig(options.config);
    this.chains = options.chains;
    this.calendar = options.calendar ?? weekdayCalendar;
    this.orderIdPrefix = options.orderIdPrefix ?? 'te-';
    this.filters = this.config.entryFilters.map(createEntryFilter);
    this.exits = this.config.exits.map(createExitRule);
    this.contracts = new ContractSelector(this.config.contract);
    this.sizer = createPositionSizer(this.config.sizing);
    this.risk = this.config.risk.map(createRiskRule);

    for (const ticker of this.config.tickers) {
      this.tickers.set(ticker, {
        ticker,
        aggregator: new BarAggregator(this.config.timeframeMinutes),
        indicators: Object.entries(this.config.indicators).map(
          ([name, config]) => [
            name,
            createIndicator(config, this.config.timeframeMinutes),
          ],
        ),
        signal: createSignal(this.config.signal),
        sessionDate: undefined,
        barIndex: -1,
        lastExit: undefined,
        entriesDate: undefined,
        entriesToday: 0,
      });
    }
  }

  /** Account equity, for `pctEquity` sizing and risk limits. Update it whenever the host learns a new value. */
  setEquity(equity: number): void {
    this.equity = equity;
  }

  getPositions(): Position[] {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  getTrades(): Trade[] {
    return [...this.trades];
  }

  /**
   * Feeds history through the indicators and signal without trading on it, so they're ready
   * before the first live bar. A few days of 1-minute bars is plenty for EMA9.
   */
  warmup(ticker: string, bars: readonly Bar[]): Promise<void> {
    return this.serialize(async () => {
      const state = this.tickerState(ticker);
      for (const bar of bars) await this.ingestBar(state, bar, false, []);
    });
  }

  /**
   * Adds a position the broker still holds from an earlier run, e.g. after a restart. Call it after
   * `warmup`, so the ticker's indicators and signal have caught up with the day. The position comes
   * back `open` and is managed like any other: pass the original `atEntry` so exits measured on the
   * underlying keep their levels. It counts as that day's entry for `maxEntriesPerDay`, and
   * `entryBarIndex` is reset to the latest bar seen, so bar-counting rules start from the restore.
   */
  restorePosition(position: Position): Promise<void> {
    return this.serialize(() => {
      const state = this.tickerState(position.ticker);
      if (this.positions.has(position.id))
        throw new Error(`Position ${position.id} is already held`);
      if (!(position.qty > 0))
        throw new Error(`Position ${position.id} has no contracts`);

      this.positions.set(position.id, {
        ...position,
        status: 'open',
        entryBarIndex: state.barIndex,
      });
      if (state.entriesDate !== position.entryDate) {
        state.entriesDate = position.entryDate;
        state.entriesToday = 0;
      }
      state.entriesToday += 1;
    });
  }

  /**
   * Asks for an exit order on an open position now, with reason `forced`, whatever its exit rules
   * say. For the host's own reasons to get flat: shutting down, stale data. Positions that are
   * still opening or already closing are left alone and produce no events.
   */
  closePosition(positionId: string, time: number): Promise<EngineEvent[]> {
    return this.serialize(() => {
      const events: EngineEvent[] = [];
      const position = this.positions.get(positionId);
      if (position?.status === 'open')
        this.placeExit(position, 'forced', time, events);
      return events;
    });
  }

  /** `closePosition` for every open position. */
  closeAll(time: number): Promise<EngineEvent[]> {
    return this.serialize(() => {
      const events: EngineEvent[] = [];
      for (const position of this.positions.values()) {
        if (position.status === 'open')
          this.placeExit(position, 'forced', time, events);
      }
      return events;
    });
  }

  /** A closed 1-minute bar for the underlying. */
  onBar(ticker: string, bar: Bar): Promise<EngineEvent[]> {
    return this.serialize(async () => {
      const state = this.tickerState(ticker);
      const events: EngineEvent[] = [];
      const clock = this.clockAt(bar.time + MINUTE_MS);
      this.checkExits(ticker, { kind: 'clock', clock, bar }, events);
      await this.ingestBar(state, bar, true, events);
      return events;
    });
  }

  /** A quote for an option contract. Quotes for contracts the engine doesn't hold are ignored. */
  onQuote(quote: OptionQuote): Promise<EngineEvent[]> {
    return this.serialize(() => {
      const events: EngineEvent[] = [];
      const clock = this.clockAt(quote.time);
      const mark = this.markOf(quote);
      for (const position of this.positions.values()) {
        if (position.contract.symbol !== quote.symbol) continue;
        position.bid = quote.bid;
        position.ask = quote.ask;
        if (position.status !== 'open' || mark === undefined) continue;
        position.mark = mark;
        position.peakMark = Math.max(position.peakMark, mark);
        this.checkPosition(position, { kind: 'mark', clock }, events);
      }
      return events;
    });
  }

  /** The broker's report on an order the engine asked for. Reports on other orders are ignored. */
  onOrderUpdate(update: OrderUpdate): Promise<EngineEvent[]> {
    return this.serialize(() => {
      const events: EngineEvent[] = [];
      const ref = this.orders.get(update.orderId);
      const position = ref && this.positions.get(ref.positionId);
      if (!ref || !position || update.status === 'partiallyFilled')
        return events;

      this.orders.delete(update.orderId);
      if (ref.action === 'open') this.settleEntry(position, update, events);
      else this.settleExit(position, ref, update, events);
      return events;
    });
  }

  // --- bars ------------------------------------------------------------------------------------

  private async ingestBar(
    state: TickerState,
    bar: Bar,
    live: boolean,
    events: EngineEvent[],
  ): Promise<void> {
    if (!this.feedsIndicators(nyTime(bar.time))) return;
    for (const timeframeBar of state.aggregator.push(bar)) {
      await this.onTimeframeBar(state, timeframeBar, live, events);
    }
  }

  private feedsIndicators({ date, minute }: NyTime): boolean {
    const regular = this.calendar.regularHours(date);
    if (!regular) return false;
    const hours = this.config.session === 'regular' ? regular : EXTENDED_HOURS;
    return minute >= hours.open && minute < hours.close;
  }

  private async onTimeframeBar(
    state: TickerState,
    bar: Bar,
    live: boolean,
    events: EngineEvent[],
  ): Promise<void> {
    const { date } = nyTime(bar.time);
    if (date !== state.sessionDate) {
      state.sessionDate = date;
      for (const [, indicator] of state.indicators) indicator.startSession();
      state.signal.startSession();
    }

    const indicators: Record<string, number | undefined> = {};
    for (const [name, indicator] of state.indicators) {
      indicators[name] = indicator.update(bar);
    }
    state.barIndex += 1;
    const clock = this.clockAt(
      bar.time + this.config.timeframeMinutes * MINUTE_MS,
    );
    const signal = state.signal.update(indicators, bar, clock);
    if (!live) return;

    const snapshot: BarSnapshot = {
      bar,
      index: state.barIndex,
      indicators,
      signal,
    };
    events.push({ type: 'bar', ticker: state.ticker, snapshot });
    // Exits first, so an opposite signal can close the old position and open the new one on the same bar.
    this.checkExits(state.ticker, { kind: 'bar', clock, snapshot }, events);
    if (signal) {
      events.push({
        type: 'signal',
        ticker: state.ticker,
        direction: signal,
        time: clock.time,
      });
      await this.tryEnter(state, signal, snapshot, clock, events);
    }
  }

  // --- entries ---------------------------------------------------------------------------------

  private async tryEnter(
    state: TickerState,
    direction: Direction,
    snapshot: BarSnapshot,
    clock: Clock,
    events: EngineEvent[],
  ): Promise<void> {
    const skip = (reason: string): void => {
      events.push({
        type: 'entrySkipped',
        ticker: state.ticker,
        direction,
        time: clock.time,
        reason,
      });
    };

    const holding = [...this.positions.values()].some(
      (p) => p.ticker === state.ticker && p.status !== 'closing',
    );
    if (holding) return skip('already in a position on this ticker');

    if (state.entriesDate !== clock.date) {
      state.entriesDate = clock.date;
      state.entriesToday = 0;
    }
    const context: EntryContext = {
      ticker: state.ticker,
      direction,
      clock,
      barIndex: snapshot.index,
      lastExit: state.lastExit,
      entriesToday: state.entriesToday,
      indicators: snapshot.indicators,
    };
    const blocked = this.filters.find((filter) => !filter.allow(context));
    if (blocked) return skip(`blocked by ${blocked.name}`);

    const type = optionTypeFor(direction);
    const underlyingPrice = snapshot.bar.close;
    const chain = await this.chains.getChain({
      underlying: state.ticker,
      type,
      time: clock.time,
      underlyingPrice,
    });
    const selection = this.contracts.select({
      chain,
      type,
      underlyingPrice,
      today: clock.date,
    });
    if (!selection.ok) return skip(selection.reason);

    const { contract } = selection;
    const multiplier = multiplierOf(contract);
    const price = contract.ask;
    if (!(price > 0)) return skip(`${contract.symbol} has no ask`);

    let qty = this.sizer.size({ price, multiplier, equity: this.equity });
    if (qty < 1) {
      const needsEquity =
        this.config.sizing.type === 'pctEquity' && this.equity === undefined;
      return skip(
        needsEquity
          ? 'sizing needs equity; call setEquity'
          : 'position size rounds to 0',
      );
    }
    const riskInput = {
      costPerContract: price * multiplier,
      tiedCapital: this.tiedCapital(),
      positions: this.positions.size,
      equity: this.equity,
    };
    for (const rule of this.risk) {
      qty = Math.min(qty, rule.maxContracts(riskInput));
      if (qty < 1) return skip(`blocked by ${rule.name}`);
    }

    const positionId = this.nextId('p');
    const orderId = this.nextId('o');
    this.positions.set(positionId, {
      id: positionId,
      ticker: state.ticker,
      direction,
      contract,
      status: 'opening',
      qty,
      entryPrice: price,
      entryTime: clock.time,
      entryDate: clock.date,
      entryBarIndex: snapshot.index,
      mark: price,
      peakMark: price,
      bid: contract.bid,
      ask: contract.ask,
      atEntry: { underlyingPrice, indicators: snapshot.indicators },
    });
    this.orders.set(orderId, { action: 'open', positionId });
    state.entriesToday += 1;
    events.push({
      type: 'order',
      order: {
        id: orderId,
        action: 'open',
        positionId,
        ticker: state.ticker,
        symbol: contract.symbol,
        side: 'buy',
        qty,
        refPrice: price,
        time: clock.time,
      },
    });
  }

  private settleEntry(
    position: Position,
    update: OrderUpdate,
    events: EngineEvent[],
  ): void {
    if (update.filledQty <= 0) {
      this.positions.delete(position.id);
      const state = this.tickers.get(position.ticker);
      if (state && state.entriesDate === position.entryDate) {
        state.entriesToday = Math.max(0, state.entriesToday - 1);
      }
      events.push({
        type: 'entryFailed',
        ticker: position.ticker,
        orderId: update.orderId,
        status: update.status,
      });
      return;
    }

    position.status = 'open';
    position.qty = update.filledQty;
    position.entryPrice = update.avgFillPrice;
    position.entryTime = update.time;
    position.entryDate = nyTime(update.time).date;
    position.mark = update.avgFillPrice;
    position.peakMark = update.avgFillPrice;
    events.push({ type: 'positionOpened', position: { ...position } });
  }

  // --- exits -----------------------------------------------------------------------------------

  private checkExits(
    ticker: string,
    event: ExitEvent,
    events: EngineEvent[],
  ): void {
    for (const position of this.positions.values()) {
      if (position.ticker === ticker && position.status === 'open') {
        this.checkPosition(position, event, events);
      }
    }
  }

  private checkPosition(
    position: Position,
    event: ExitEvent,
    events: EngineEvent[],
  ): void {
    const rule = this.exits.find((exit) => exit.shouldExit(position, event));
    if (rule) this.placeExit(position, rule.reason, event.clock.time, events);
  }

  private placeExit(
    position: Position,
    reason: ExitReason,
    time: number,
    events: EngineEvent[],
  ): void {
    const orderId = this.nextId('o');
    position.status = 'closing';
    this.orders.set(orderId, {
      action: 'close',
      positionId: position.id,
      reason,
      barIndex: this.tickers.get(position.ticker)?.barIndex ?? 0,
    });
    events.push({
      type: 'order',
      order: {
        id: orderId,
        action: 'close',
        positionId: position.id,
        ticker: position.ticker,
        symbol: position.contract.symbol,
        side: 'sell',
        qty: position.qty,
        refPrice: position.bid ?? position.mark,
        time,
        reason,
      },
    });
  }

  private settleExit(
    position: Position,
    ref: Extract<OrderRef, { action: 'close' }>,
    update: OrderUpdate,
    events: EngineEvent[],
  ): void {
    const sold = Math.min(update.filledQty, position.qty);
    const trade =
      sold > 0
        ? this.recordTrade(position, sold, ref.reason, update)
        : undefined;
    const remaining = position.qty - sold;

    if (trade && remaining <= 0) {
      this.positions.delete(position.id);
      const state = this.tickers.get(position.ticker);
      if (state)
        state.lastExit = {
          reason: ref.reason,
          barIndex: ref.barIndex,
          time: update.time,
        };
      events.push({ type: 'positionClosed', trade });
      return;
    }

    position.qty = remaining;
    position.status = 'open';
    events.push({
      type: 'exitFailed',
      ticker: position.ticker,
      orderId: update.orderId,
      status: update.status,
      ...(trade ? { trade } : {}),
    });
  }

  private recordTrade(
    position: Position,
    qty: number,
    reason: ExitReason,
    update: OrderUpdate,
  ): Trade {
    const multiplier = multiplierOf(position.contract);
    const trade: Trade = {
      positionId: position.id,
      ticker: position.ticker,
      direction: position.direction,
      symbol: position.contract.symbol,
      qty,
      multiplier,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime: update.time,
      exitPrice: update.avgFillPrice,
      reason,
      pnl: (update.avgFillPrice - position.entryPrice) * qty * multiplier,
      pnlPct: pnlPct(position.entryPrice, update.avgFillPrice),
    };
    this.trades.push(trade);
    return trade;
  }

  // --- helpers ---------------------------------------------------------------------------------

  private markOf(quote: OptionQuote): number | undefined {
    const { bid, ask, last } = quote;
    switch (this.config.markPrice) {
      case 'mid':
        return ask > 0 && bid >= 0 && ask >= bid ? (bid + ask) / 2 : undefined;
      case 'bid':
        return bid >= 0 ? bid : undefined;
      case 'last':
        return last;
    }
  }

  private tiedCapital(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total +=
        position.qty * position.entryPrice * multiplierOf(position.contract);
    }
    return total;
  }

  private clockAt(time: number): Clock {
    const { date, minute } = nyTime(time);
    return { time, date, minute, hours: this.calendar.regularHours(date) };
  }

  private tickerState(ticker: string): TickerState {
    const state = this.tickers.get(ticker);
    if (!state) throw new Error(`${ticker} is not in this strategy's tickers`);
    return state;
  }

  private nextId(kind: 'o' | 'p'): string {
    this.sequence += 1;
    return `${this.orderIdPrefix}${kind}${this.sequence}`;
  }

  private serialize<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
