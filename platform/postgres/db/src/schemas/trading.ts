import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * The trading bot's forward test (projects/trading/bot). Everything it saw and did is kept, raw
 * where possible, so a later run (or an agent) can replay a day, compare it with the backtest, or
 * try a change against what really happened.
 */
export const tradingPgSchema = pgSchema('trading');

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One process lifetime. Its id prefixes every client order id the run sends. */
export const tradingRuns = tradingPgSchema.table('runs', {
  id: text('id').primaryKey(),
  startedAt: at('started_at').notNull().defaultNow(),
  endedAt: at('ended_at'),
  /** Why it stopped: `shutdown`, `error: ...`. */
  endReason: text('end_reason'),
  version: text('version').notNull(),
  environment: text('environment').notNull(),
  /** `paper` (the bot refuses anything else). */
  account: text('account').notNull(),
  stockFeed: text('stock_feed').notNull(),
  optionsFeed: text('options_feed').notNull(),
  /** The parsed strategy config. */
  strategy: jsonb('strategy').notNull(),
  /** Order handling, staleness and schedule settings. */
  settings: jsonb('settings').notNull(),
});

/** Every 1-minute underlying bar the bot fed its engine, from the stream or a REST backfill. */
export const tradingBars = tradingPgSchema.table(
  'bars',
  {
    ticker: text('ticker').notNull(),
    feed: text('feed').notNull(),
    /** Bar start. */
    time: at('time').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull(),
    /** `stream`, `backfill` or `warmup`. */
    source: text('source').notNull(),
    receivedAt: at('received_at').notNull(),
    /** Set when the stream sent a correction after the bar was used. The columns above stay as used. */
    correction: jsonb('correction'),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.feed, table.time] })],
);

/** Quotes for contracts the bot held or was trading, as they were polled. */
export const tradingOptionQuotes = tradingPgSchema.table(
  'option_quotes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    symbol: text('symbol').notNull(),
    feed: text('feed').notNull(),
    /** The quote's own timestamp. */
    time: at('time').notNull(),
    receivedAt: at('received_at').notNull(),
    bid: doublePrecision('bid').notNull(),
    ask: doublePrecision('ask').notNull(),
    bidSize: integer('bid_size'),
    askSize: integer('ask_size'),
  },
  (table) => [
    index('option_quotes_symbol_time_idx').on(table.symbol, table.time),
  ],
);

/** The option chain the engine chose a contract from, at decision time. */
export const tradingChainSnapshots = tradingPgSchema.table(
  'chain_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    time: at('time').notNull(),
    underlying: text('underlying').notNull(),
    type: text('type').notNull(),
    underlyingPrice: doublePrecision('underlying_price').notNull(),
    feed: text('feed').notNull(),
    /** `[{ symbol, strike, expiration, bid, ask, bidSize, askSize, quoteTime }]` */
    contracts: jsonb('contracts').notNull(),
  },
  (table) => [index('chain_snapshots_time_idx').on(table.time)],
);

/** Every engine event, including the timeframe bar snapshots with their indicator values. */
export const tradingEngineEvents = tradingPgSchema.table(
  'engine_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    time: at('time').notNull(),
    type: text('type').notNull(),
    ticker: text('ticker'),
    payload: jsonb('payload').notNull(),
  },
  (table) => [
    index('engine_events_run_id_time_idx').on(table.runId, table.time),
    index('engine_events_type_time_idx').on(table.type, table.time),
  ],
);

/** Each order sent to the broker. One engine order intent can take several (reprices, a market fallback). */
export const tradingBrokerOrders = tradingPgSchema.table(
  'broker_orders',
  {
    clientOrderId: text('client_order_id').primaryKey(),
    runId: text('run_id').notNull(),
    /** The engine's order id this order works. */
    intentId: text('intent_id').notNull(),
    /** 0 for the first order, 1 for the first reprice, ... */
    attempt: integer('attempt').notNull(),
    brokerOrderId: text('broker_order_id'),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    type: text('type').notNull(),
    qty: integer('qty').notNull(),
    limitPrice: doublePrecision('limit_price'),
    status: text('status').notNull(),
    filledQty: integer('filled_qty').notNull().default(0),
    filledAvgPrice: doublePrecision('filled_avg_price'),
    submittedAt: at('submitted_at').notNull(),
    updatedAt: at('updated_at').notNull(),
    /** The bid and ask the bot knew when it sent the order. */
    quoteAtSubmit: jsonb('quote_at_submit'),
    raw: jsonb('raw'),
  },
  (table) => [index('broker_orders_intent_id_idx').on(table.intentId)],
);

/** The broker's trade-update stream, verbatim. */
export const tradingTradeUpdates = tradingPgSchema.table(
  'trade_updates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    clientOrderId: text('client_order_id').notNull(),
    event: text('event').notNull(),
    time: at('time').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (table) => [
    index('trade_updates_client_order_id_idx').on(table.clientOrderId),
  ],
);

/**
 * Positions as the engine knows them, kept current so a restart can hand them back to a new
 * engine with `restorePosition`.
 */
export const tradingPositions = tradingPgSchema.table(
  'positions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    ticker: text('ticker').notNull(),
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    qty: integer('qty').notNull(),
    entryPrice: doublePrecision('entry_price').notNull(),
    entryTime: at('entry_time').notNull(),
    entryDate: text('entry_date').notNull(),
    /** The engine's `Position`, whole: contract, `atEntry` levels, marks. */
    position: jsonb('position').notNull(),
    /** `open` or `closed`. */
    status: text('status').notNull(),
    closedAt: at('closed_at'),
    updatedAt: at('updated_at').notNull(),
  },
  (table) => [index('positions_status_idx').on(table.status)],
);

/** Contracts bought and sold, with what the bot expected to pay and get. */
export const tradingTrades = tradingPgSchema.table(
  'trades',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    positionId: text('position_id').notNull(),
    tradeDate: text('trade_date').notNull(),
    ticker: text('ticker').notNull(),
    direction: text('direction').notNull(),
    symbol: text('symbol').notNull(),
    qty: integer('qty').notNull(),
    reason: text('reason').notNull(),
    entryTime: at('entry_time').notNull(),
    exitTime: at('exit_time').notNull(),
    entryPrice: doublePrecision('entry_price').notNull(),
    exitPrice: doublePrecision('exit_price').notNull(),
    /** The ask the engine decided on. */
    entryRefPrice: doublePrecision('entry_ref_price'),
    /** The bid the engine decided on. */
    exitRefPrice: doublePrecision('exit_ref_price'),
    /** Per share, positive is worse than the reference: paid above it, or sold below it. */
    entrySlippage: doublePrecision('entry_slippage'),
    exitSlippage: doublePrecision('exit_slippage'),
    pnl: doublePrecision('pnl').notNull(),
    /** Estimated from the configured fee per contract. */
    fees: doublePrecision('fees').notNull(),
    netPnl: doublePrecision('net_pnl').notNull(),
    /**
     * The real NBBO at the decision times, filled in after the fact (e.g. from Theta Data) for
     * runs on the indicative feed: `{ entry: { bid, ask }, exit: { bid, ask } }`.
     */
    nbbo: jsonb('nbbo'),
  },
  (table) => [index('trades_trade_date_idx').on(table.tradeDate)],
);

/** One row per trading day: the forward-test record to compare with the backtest. */
export const tradingDays = tradingPgSchema.table('days', {
  date: text('date').primaryKey(),
  /** The runs that traded this day; more than one after a restart. */
  runIds: jsonb('run_ids').notNull(),
  stockFeed: text('stock_feed').notNull(),
  optionsFeed: text('options_feed').notNull(),
  /** `[{ direction, time, outcome, reason?, boxHigh, boxLow, ema50, ema200, close }]` */
  signals: jsonb('signals').notNull(),
  /** Trades closed this day, summarized as in `trades`. */
  trades: jsonb('trades').notNull(),
  netPnl: doublePrecision('net_pnl').notNull(),
  /** Bars received per session part, gaps backfilled, stale periods, reconnects, rejects. */
  dataHealth: jsonb('data_health').notNull(),
  /** Options level, PDT fields and equity, read before the session. */
  account: jsonb('account'),
  updatedAt: at('updated_at').notNull(),
});

/** Anything that went wrong or needed a decision: stale data, reconnects, restores, flattens. */
export const tradingIncidents = tradingPgSchema.table(
  'incidents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    time: at('time').notNull(),
    kind: text('kind').notNull(),
    details: jsonb('details').notNull(),
  },
  (table) => [index('incidents_time_idx').on(table.time)],
);

export const tradingSchema = {
  runs: tradingRuns,
  bars: tradingBars,
  optionQuotes: tradingOptionQuotes,
  chainSnapshots: tradingChainSnapshots,
  engineEvents: tradingEngineEvents,
  brokerOrders: tradingBrokerOrders,
  tradeUpdates: tradingTradeUpdates,
  positions: tradingPositions,
  trades: tradingTrades,
  days: tradingDays,
  incidents: tradingIncidents,
};
