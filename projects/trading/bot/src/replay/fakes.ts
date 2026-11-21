import {
  Bar,
  CalendarDay,
  EngineEvent,
  nyTime,
  OptionType,
} from '@projects/trading-core';

import { parseOccSymbol } from '../host/occ';
import {
  AccountInfo,
  Broker,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerPosition,
  DayRecord,
  isFinal,
  MarketData,
  OptionChainRequest,
  OptionQuoteSnapshot,
  OrderRejectedError,
  RecordedOrder,
  RecordedTrade,
  Recorder,
  SavedPosition,
  Timers,
} from '../host/ports';

import { quoteAt, QuoteRow, ReplayFixture, toBar } from './fixture';

/** A clock the replay moves by hand. Sleeping just moves it forward. */
export class ReplayTimers implements Timers {
  private time: number;

  constructor(start: number) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  /** Moves the clock, then lets everything already queued run before resolving. */
  sleep(ms: number): Promise<void> {
    this.time += Math.max(0, ms);
    return new Promise((resolve) => setImmediate(resolve));
  }

  advanceTo(time: number): void {
    this.time = Math.max(this.time, time);
  }
}

/** The fixture's quotes at the replay clock's time. */
export class QuoteBook {
  private readonly fixture: ReplayFixture;

  constructor(fixture: ReplayFixture) {
    this.fixture = fixture;
  }

  at(symbol: string, time: number): OptionQuoteSnapshot | undefined {
    const rows = this.fixture.quotes[nyTime(time).date]?.[symbol];
    const row = rows && quoteAt(rows, time);
    return row ? { symbol, time: row[0], bid: row[1], ask: row[2] } : undefined;
  }

  symbols(date: string): Array<[string, QuoteRow[]]> {
    return Object.entries(this.fixture.quotes[date] ?? {});
  }
}

export class FixtureMarketData implements MarketData {
  private readonly fixture: ReplayFixture;
  private readonly quotes: QuoteBook;
  private readonly timers: Timers;
  readonly chainRequests: OptionChainRequest[] = [];

  constructor(fixture: ReplayFixture, quotes: QuoteBook, timers: Timers) {
    this.fixture = fixture;
    this.quotes = quotes;
    this.timers = timers;
  }

  calendar(start: string, end: string): Promise<CalendarDay[]> {
    return Promise.resolve(
      this.fixture.calendar.filter((d) => d.date >= start && d.date <= end),
    );
  }

  stockBars(_ticker: string, start: number, end: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    for (const date of [nyTime(start).date, nyTime(end - 1).date]) {
      for (const row of this.fixture.bars[date] ?? []) {
        if (row[0] >= start && row[0] < end) bars.push(toBar(row));
      }
    }
    const unique = new Map(bars.map((bar) => [bar.time, bar]));
    return Promise.resolve(
      [...unique.values()].sort((a, b) => a.time - b.time),
    );
  }

  optionChain(request: OptionChainRequest): Promise<OptionQuoteSnapshot[]> {
    this.chainRequests.push(request);
    const out: OptionQuoteSnapshot[] = [];
    for (const [symbol] of this.quotes.symbols(nyTime(request.asOf).date)) {
      const occ = parseOccSymbol(symbol);
      if (
        !occ ||
        occ.underlying !== request.underlying ||
        occ.type !== request.type
      )
        continue;
      if (
        occ.expiration < request.expirationFrom ||
        occ.expiration > request.expirationTo
      )
        continue;
      if (occ.strike < request.strikeFrom || occ.strike > request.strikeTo)
        continue;
      const quote = this.quotes.at(symbol, request.asOf);
      if (quote) out.push(quote);
    }
    return Promise.resolve(out);
  }

  latestOptionQuotes(
    symbols: readonly string[],
  ): Promise<OptionQuoteSnapshot[]> {
    const now = this.timers.now();
    return Promise.resolve(
      symbols.flatMap((symbol) => {
        const quote = this.quotes.at(symbol, now);
        return quote ? [quote] : [];
      }),
    );
  }
}

export type FillRule = (
  request: BrokerOrderRequest,
  quote: OptionQuoteSnapshot | undefined,
) => { fillQty: number; price: number } | 'rest' | 'reject';

/**
 * Fills the way the backtest's simulated broker does with real quotes: buys at the ask and sells
 * at the bid standing when the order arrives. A limit that isn't marketable then rests until
 * canceled. `fillRule` can replace that to test partial fills and slow markets.
 */
export const marketableFill: FillRule = (request, quote) => {
  if (!quote) return request.type === 'market' ? 'reject' : 'rest';
  const price = request.side === 'buy' ? quote.ask : quote.bid;
  if (!(price > 0)) return request.type === 'market' ? 'reject' : 'rest';
  if (request.type === 'market') return { fillQty: request.qty, price };
  const limit = request.limitPrice ?? 0;
  const marketable = request.side === 'buy' ? limit >= price : limit <= price;
  return marketable ? { fillQty: request.qty, price } : 'rest';
};

export class ReplayBroker implements Broker {
  readonly orders = new Map<string, BrokerOrder>();
  readonly requests: BrokerOrderRequest[] = [];
  private readonly positions = new Map<string, { qty: number; cost: number }>();
  private readonly quotes: QuoteBook;
  private readonly timers: Timers;
  private sequence = 0;
  fillRule: FillRule = marketableFill;
  account: AccountInfo = {
    status: 'ACTIVE',
    equity: 100_000,
    multiplier: 4,
    optionsApprovedLevel: 3,
    optionsTradingLevel: 3,
    patternDayTrader: false,
    daytradeCount: 0,
    tradingBlocked: false,
    accountBlocked: false,
  };
  /** Called with each order change, the way the trade-update stream would. */
  onUpdate: (event: string, order: BrokerOrder) => void = () => undefined;

  constructor(quotes: QuoteBook, timers: Timers) {
    this.quotes = quotes;
    this.timers = timers;
  }

  submitOrder(request: BrokerOrderRequest): Promise<BrokerOrder> {
    this.requests.push(request);
    if (
      [...this.orders.values()].some(
        (o) => o.clientOrderId === request.clientOrderId,
      )
    )
      return Promise.reject(
        new OrderRejectedError(422, 'client_order_id must be unique'),
      );
    const now = this.timers.now();
    const result = this.fillRule(request, this.quotes.at(request.symbol, now));
    if (result === 'reject')
      return Promise.reject(
        new OrderRejectedError(403, 'no market for this contract'),
      );

    this.sequence += 1;
    let order: BrokerOrder = {
      id: `fake-${this.sequence}`,
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      qty: request.qty,
      limitPrice: request.limitPrice ?? null,
      status: 'new',
      filledQty: 0,
      filledAvgPrice: null,
      updatedAt: now,
    };
    if (result !== 'rest') {
      const filled = Math.min(request.qty, result.fillQty);
      order = {
        ...order,
        filledQty: filled,
        filledAvgPrice: result.price,
        status: filled >= request.qty ? 'filled' : 'partially_filled',
      };
      this.book(request.symbol, request.side, filled, result.price);
    }
    this.orders.set(order.id, order);
    this.onUpdate(
      order.status === 'new'
        ? 'new'
        : order.status === 'filled'
          ? 'fill'
          : 'partial_fill',
      order,
    );
    return Promise.resolve(order);
  }

  cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) return Promise.reject(new Error('404 order not found'));
    if (isFinal(order))
      return Promise.reject(new Error('422 order is already final'));
    const canceled = {
      ...order,
      status: 'canceled',
      updatedAt: this.timers.now(),
    };
    this.orders.set(orderId, canceled);
    this.onUpdate('canceled', canceled);
    return Promise.resolve();
  }

  getOrder(orderId: string): Promise<BrokerOrder> {
    const order = this.orders.get(orderId);
    return order
      ? Promise.resolve(order)
      : Promise.reject(new Error('404 order not found'));
  }

  listOpenOrders(): Promise<BrokerOrder[]> {
    return Promise.resolve(
      [...this.orders.values()].filter((o) => !isFinal(o)),
    );
  }

  listPositions(): Promise<BrokerPosition[]> {
    return Promise.resolve(
      [...this.positions.entries()]
        .filter(([, p]) => p.qty !== 0)
        .map(([symbol, p]) => ({
          symbol,
          qty: p.qty,
          avgEntryPrice: p.cost / p.qty,
          assetClass: 'us_option',
        })),
    );
  }

  getAccount(): Promise<AccountInfo> {
    return Promise.resolve(this.account);
  }

  /** Puts a position on the books directly, as if an earlier run had bought it. */
  hold(symbol: string, qty: number, price: number): void {
    this.book(symbol, 'buy', qty, price);
  }

  private book(
    symbol: string,
    side: 'buy' | 'sell',
    qty: number,
    price: number,
  ): void {
    const position = this.positions.get(symbol) ?? { qty: 0, cost: 0 };
    if (side === 'buy') {
      position.qty += qty;
      position.cost += qty * price;
    } else {
      const avg = position.qty > 0 ? position.cost / position.qty : 0;
      position.qty -= qty;
      position.cost -= qty * avg;
    }
    this.positions.set(symbol, position);
  }
}

/** Keeps everything in memory, for assertions. */
export class MemoryRecorder implements Recorder {
  readonly events: Array<{ time: number; event: EngineEvent }> = [];
  readonly orders: RecordedOrder[] = [];
  readonly trades: RecordedTrade[] = [];
  readonly days = new Map<string, DayRecord>();
  readonly incidents: Array<{ kind: string; details: unknown }> = [];
  readonly positions = new Map<string, SavedPosition>();
  readonly chains: Array<{
    time: number;
    type: OptionType;
    contracts: number;
  }> = [];
  bars = 0;
  /** How often each method nothing else here records was called. */
  readonly calls = new Map<string, number>();

  private count(name: string): void {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
  }

  startRun(): void {
    this.count('startRun');
  }
  endRun(): void {
    this.count('endRun');
  }
  bar(): void {
    this.bars += 1;
  }
  barCorrection(): void {
    this.count('barCorrection');
  }
  quote(): void {
    this.count('quote');
  }
  chain(
    _runId: string,
    _feed: string,
    request: { time: number; type: OptionType },
    contracts: readonly OptionQuoteSnapshot[],
  ): void {
    this.chains.push({
      time: request.time,
      type: request.type,
      contracts: contracts.length,
    });
  }
  engineEvent(_runId: string, time: number, event: EngineEvent): void {
    this.events.push({ time, event });
  }
  order(order: RecordedOrder): void {
    this.orders.push(order);
  }
  tradeUpdate(): void {
    this.count('tradeUpdate');
  }
  savePosition(position: SavedPosition): void {
    this.positions.set(position.position.id, position);
  }
  trade(trade: RecordedTrade): void {
    this.trades.push(trade);
  }
  day(record: DayRecord): void {
    this.days.set(record.date, record);
  }
  incident(
    _runId: string,
    _time: number,
    kind: string,
    details: unknown,
  ): void {
    this.incidents.push({ kind, details });
  }
  loadOpenPositions(): Promise<SavedPosition[]> {
    return Promise.resolve(
      [...this.positions.values()].filter(
        (p) => p.status === 'open' || p.status === 'opening',
      ),
    );
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
}
