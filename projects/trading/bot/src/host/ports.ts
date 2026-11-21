import {
  Bar,
  CalendarDay,
  EngineEvent,
  IndicatorValues,
  OptionType,
  Position,
  Trade,
} from '@projects/trading-core';

/**
 * Everything the host needs from the outside world. The live bot implements these with Alpaca and
 * Postgres; the replay test implements them with recorded data, so both run the same host code.
 */

export type StockFeed = 'sip' | 'iex';
export type OptionsFeed = 'opra' | 'indicative';

// --- broker --------------------------------------------------------------------------------------

export type BrokerOrderRequest = {
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'limit' | 'market';
  limitPrice?: number;
};

/** An order as the broker last reported it. Quantities are cumulative. */
export type BrokerOrder = {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  qty: number;
  limitPrice: number | null;
  /** Alpaca's status: `new`, `partially_filled`, `filled`, `canceled`, ... */
  status: string;
  filledQty: number;
  filledAvgPrice: number | null;
  /** Epoch ms of the broker's last change. */
  updatedAt: number;
  raw?: unknown;
};

/** Statuses after which an order can't fill any more. */
export const FINAL_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'filled',
  'canceled',
  'expired',
  'rejected',
  'done_for_day',
  'replaced',
]);

export const isFinal = (order: BrokerOrder): boolean =>
  FINAL_ORDER_STATUSES.has(order.status);

export type BrokerPosition = {
  symbol: string;
  /** Positive for long, negative for short. */
  qty: number;
  avgEntryPrice: number;
  assetClass: string;
};

export type AccountInfo = {
  status: string;
  equity: number;
  /** 1 for a cash account, 2 or 4 for margin. */
  multiplier: number;
  optionsApprovedLevel: number | null;
  optionsTradingLevel: number | null;
  /** Null when the broker doesn't report it. */
  patternDayTrader: boolean | null;
  daytradeCount: number | null;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  raw?: unknown;
};

/** The broker's trading API. Errors are thrown; `OrderRejectedError` when the broker refuses an order. */
export interface Broker {
  submitOrder(request: BrokerOrderRequest): Promise<BrokerOrder>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<BrokerOrder>;
  listOpenOrders(): Promise<BrokerOrder[]>;
  listPositions(): Promise<BrokerPosition[]>;
  getAccount(): Promise<AccountInfo>;
}

export class OrderRejectedError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Order rejected (${status}): ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

// --- market data ---------------------------------------------------------------------------------

/** One contract's quote. `time` is the quote's own timestamp. */
export type OptionQuoteSnapshot = {
  symbol: string;
  bid: number;
  ask: number;
  bidSize?: number;
  askSize?: number;
  time: number;
};

export type OptionChainRequest = {
  underlying: string;
  type: OptionType;
  /** `YYYY-MM-DD`, inclusive. */
  expirationFrom: string;
  expirationTo: string;
  strikeFrom: number;
  strikeTo: number;
  /**
   * The decision time. The live implementation returns the latest quotes and ignores it; the
   * replay returns the quotes that stood then.
   */
  asOf: number;
};

export interface MarketData {
  calendar(start: string, end: string): Promise<CalendarDay[]>;
  /** 1-minute bars with `start <= time < end` (bar start times, epoch ms), sorted. */
  stockBars(ticker: string, start: number, end: number): Promise<Bar[]>;
  optionChain(request: OptionChainRequest): Promise<OptionQuoteSnapshot[]>;
  latestOptionQuotes(
    symbols: readonly string[],
  ): Promise<OptionQuoteSnapshot[]>;
}

// --- time ----------------------------------------------------------------------------------------

export interface Timers {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realTimers: Timers = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// --- recording -----------------------------------------------------------------------------------

export type BarSource = 'stream' | 'backfill' | 'warmup';

export type RecordedOrder = {
  runId: string;
  intentId: string;
  attempt: number;
  order: BrokerOrder;
  submittedAt: number;
  quoteAtSubmit?: OptionQuoteSnapshot;
};

export type RecordedTrade = Trade & {
  runId: string;
  tradeDate: string;
  entryRefPrice?: number;
  exitRefPrice?: number;
  entrySlippage?: number;
  exitSlippage?: number;
  fees: number;
  netPnl: number;
};

export type SavedPosition = {
  runId: string;
  position: Position;
  status: 'opening' | 'open' | 'closed' | 'failed';
  /** The ask the entry was decided on, for slippage after a restore. */
  entryRefPrice?: number;
};

export type SignalOutcome =
  'skipped' | 'ordered' | 'entered' | 'entryFailed' | 'blockedByHost';

/** One signal and what came of it. */
export type SignalRow = {
  direction: string;
  time: number;
  outcome: SignalOutcome;
  reason?: string;
  symbol?: string;
  /** The ask the engine decided on. */
  refPrice?: number;
  fillPrice?: number;
  filledQty?: number;
  /** Fill minus reference, per share. */
  slippage?: number;
  /** The underlying's close and every indicator on the bar that signaled (box, EMAs). */
  close?: number;
  indicators?: IndicatorValues;
};

export type DayRecord = {
  date: string;
  runIds: string[];
  stockFeed: StockFeed;
  optionsFeed: OptionsFeed;
  signals: SignalRow[];
  trades: RecordedTrade[];
  netPnl: number;
  dataHealth: Record<string, unknown>;
  account?: unknown;
};

export type RunRecord = {
  id: string;
  version: string;
  environment: string;
  account: 'paper';
  stockFeed: StockFeed;
  optionsFeed: OptionsFeed;
  strategy: unknown;
  settings: unknown;
};

/**
 * Where the forward test is written. Calls are fire-and-forget from the host's point of view: an
 * implementation must never throw into trading code, and should queue writes rather than block.
 */
export interface Recorder {
  startRun(run: RunRecord): void;
  endRun(runId: string, reason: string): void;
  bar(ticker: string, feed: StockFeed, bar: Bar, source: BarSource): void;
  barCorrection(ticker: string, feed: StockFeed, bar: Bar): void;
  quote(runId: string, feed: OptionsFeed, quote: OptionQuoteSnapshot): void;
  chain(
    runId: string,
    feed: OptionsFeed,
    request: {
      time: number;
      underlying: string;
      type: OptionType;
      underlyingPrice: number;
    },
    contracts: readonly OptionQuoteSnapshot[],
  ): void;
  engineEvent(runId: string, time: number, event: EngineEvent): void;
  order(order: RecordedOrder): void;
  tradeUpdate(
    runId: string,
    clientOrderId: string,
    event: string,
    time: number,
    payload: unknown,
  ): void;
  savePosition(position: SavedPosition): void;
  trade(trade: RecordedTrade): void;
  day(record: DayRecord): void;
  incident(runId: string, time: number, kind: string, details: unknown): void;
  /** Positions not yet closed, from every earlier run. */
  loadOpenPositions(): Promise<SavedPosition[]>;
  /** Resolves once everything queued so far is written. */
  flush(): Promise<void>;
}

// --- logging -------------------------------------------------------------------------------------

export interface Log {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentLog: Log = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
