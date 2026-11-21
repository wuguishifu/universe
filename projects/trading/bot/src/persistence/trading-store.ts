import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { UNIVERSE_DB, type UniverseDb } from '@libs/nest-universe-db';
import {
  tradingBars,
  tradingBrokerOrders,
  tradingChainSnapshots,
  tradingDays,
  tradingEngineEvents,
  tradingIncidents,
  tradingOptionQuotes,
  tradingPositions,
  tradingRuns,
  tradingTrades,
  tradingTradeUpdates,
} from '@platform/postgres-db';
import { Bar, EngineEvent, OptionType, Position } from '@projects/trading-core';

import {
  BarSource,
  DayRecord,
  OptionQuoteSnapshot,
  OptionsFeed,
  RecordedOrder,
  RecordedTrade,
  Recorder,
  RunRecord,
  SavedPosition,
  SignalRow,
  StockFeed,
} from '../host/ports';

const date = (time: number) => new Date(time);

const signalKey = (row: SignalRow) => `${row.time}:${row.direction}`;
const tradeKey = (row: RecordedTrade) => `${row.positionId}:${row.exitTime}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** jsonb columns come back as `unknown`; these check just enough to trust what this class wrote. */
const storedPositionSchema = z.custom<Position & { entryRefPrice?: number }>(
  (value) =>
    isObject(value) &&
    typeof value['id'] === 'string' &&
    isObject(value['contract']),
);
const savedStatusSchema = z.enum(['opening', 'open', 'closed', 'failed']);
const signalRowsSchema = z
  .array(
    z.custom<SignalRow>(
      (value) => isObject(value) && typeof value['time'] === 'number',
    ),
  )
  .catch([]);
const tradeRowsSchema = z
  .array(
    z.custom<RecordedTrade>(
      (value) => isObject(value) && typeof value['positionId'] === 'string',
    ),
  )
  .catch([]);
const stringsSchema = z.array(z.string()).catch([]);
const objectSchema = z.record(z.string(), z.unknown()).catch({});

/**
 * Writes the forward test to the `trading` schema in universe-db. Every write goes through one
 * queue, in order, and a failed write is logged and dropped: the record must never stop trading.
 */
@Injectable()
export class TradingStore implements Recorder {
  private readonly logger = new Logger(TradingStore.name);
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(@Inject(UNIVERSE_DB) private readonly db: UniverseDb) {}

  get backlog(): number {
    return this.pending;
  }

  startRun(run: RunRecord): void {
    this.write('run', () => this.db.insert(tradingRuns).values(run));
  }

  endRun(runId: string, reason: string): void {
    this.write('endRun', () =>
      this.db
        .update(tradingRuns)
        .set({ endedAt: new Date(), endReason: reason })
        .where(eq(tradingRuns.id, runId)),
    );
  }

  bar(ticker: string, feed: StockFeed, bar: Bar, source: BarSource): void {
    this.write('bar', () =>
      this.db
        .insert(tradingBars)
        .values({
          ticker,
          feed,
          source,
          ...bar,
          time: date(bar.time),
          receivedAt: new Date(),
        })
        .onConflictDoNothing(),
    );
  }

  barCorrection(ticker: string, feed: StockFeed, bar: Bar): void {
    this.write('barCorrection', () =>
      this.db
        .update(tradingBars)
        .set({ correction: { ...bar, receivedAt: Date.now() } })
        .where(
          and(
            eq(tradingBars.ticker, ticker),
            eq(tradingBars.feed, feed),
            eq(tradingBars.time, date(bar.time)),
          ),
        ),
    );
  }

  quote(runId: string, feed: OptionsFeed, quote: OptionQuoteSnapshot): void {
    this.write('quote', () =>
      this.db.insert(tradingOptionQuotes).values({
        runId,
        feed,
        symbol: quote.symbol,
        time: date(quote.time),
        receivedAt: new Date(),
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
      }),
    );
  }

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
  ): void {
    this.write('chain', () =>
      this.db.insert(tradingChainSnapshots).values({
        runId,
        feed,
        time: date(request.time),
        underlying: request.underlying,
        type: request.type,
        underlyingPrice: request.underlyingPrice,
        contracts,
      }),
    );
  }

  engineEvent(runId: string, time: number, event: EngineEvent): void {
    const ticker = tickerOf(event);
    this.write('engineEvent', () =>
      this.db.insert(tradingEngineEvents).values({
        runId,
        time: date(time),
        type: event.type,
        ticker,
        payload: event,
      }),
    );
  }

  order({
    runId,
    intentId,
    attempt,
    order,
    submittedAt,
    quoteAtSubmit,
  }: RecordedOrder): void {
    const values = {
      brokerOrderId: order.id || null,
      status: order.status,
      filledQty: order.filledQty,
      filledAvgPrice: order.filledAvgPrice,
      updatedAt: date(order.updatedAt),
      raw: order.raw ?? null,
    };
    this.write('order', () =>
      this.db
        .insert(tradingBrokerOrders)
        .values({
          clientOrderId: order.clientOrderId,
          runId,
          intentId,
          attempt,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          qty: order.qty,
          limitPrice: order.limitPrice,
          submittedAt: date(submittedAt),
          quoteAtSubmit: quoteAtSubmit ?? null,
          ...values,
        })
        .onConflictDoUpdate({
          target: tradingBrokerOrders.clientOrderId,
          set: values,
        }),
    );
  }

  tradeUpdate(
    runId: string,
    clientOrderId: string,
    event: string,
    time: number,
    payload: unknown,
  ): void {
    this.write('tradeUpdate', () =>
      this.db
        .insert(tradingTradeUpdates)
        .values({ runId, clientOrderId, event, time: date(time), payload }),
    );
  }

  savePosition({
    runId,
    position,
    status,
    entryRefPrice,
  }: SavedPosition): void {
    const values = {
      runId,
      qty: position.qty,
      entryPrice: position.entryPrice,
      entryTime: date(position.entryTime),
      entryDate: position.entryDate,
      position: { ...position, entryRefPrice },
      status,
      closedAt: status === 'closed' ? new Date() : null,
      updatedAt: new Date(),
    };
    this.write('position', () =>
      this.db
        .insert(tradingPositions)
        .values({
          id: position.id,
          ticker: position.ticker,
          symbol: position.contract.symbol,
          direction: position.direction,
          ...values,
        })
        .onConflictDoUpdate({ target: tradingPositions.id, set: values }),
    );
  }

  trade(trade: RecordedTrade): void {
    this.write('trade', () =>
      this.db.insert(tradingTrades).values({
        runId: trade.runId,
        positionId: trade.positionId,
        tradeDate: trade.tradeDate,
        ticker: trade.ticker,
        direction: trade.direction,
        symbol: trade.symbol,
        qty: trade.qty,
        reason: trade.reason,
        entryTime: date(trade.entryTime),
        exitTime: date(trade.exitTime),
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        entryRefPrice: trade.entryRefPrice,
        exitRefPrice: trade.exitRefPrice,
        entrySlippage: trade.entrySlippage,
        exitSlippage: trade.exitSlippage,
        pnl: trade.pnl,
        fees: trade.fees,
        netPnl: trade.netPnl,
      }),
    );
  }

  /** Merges into the day's row, so a restart adds to the record rather than replacing it. */
  day(record: DayRecord): void {
    this.write('day', async () => {
      const [existing] = await this.db
        .select()
        .from(tradingDays)
        .where(eq(tradingDays.date, record.date));
      const merged = existing ? mergeDay(existing, record) : record;
      const values = {
        runIds: merged.runIds,
        stockFeed: merged.stockFeed,
        optionsFeed: merged.optionsFeed,
        signals: merged.signals,
        trades: merged.trades,
        netPnl: merged.netPnl,
        dataHealth: merged.dataHealth,
        account: merged.account ?? null,
        updatedAt: new Date(),
      };
      await this.db
        .insert(tradingDays)
        .values({ date: record.date, ...values })
        .onConflictDoUpdate({ target: tradingDays.date, set: values });
    });
  }

  incident(runId: string, time: number, kind: string, details: unknown): void {
    this.logger.warn({ message: 'incident', kind, details });
    this.write('incident', () =>
      this.db
        .insert(tradingIncidents)
        .values({ runId, time: date(time), kind, details: details ?? {} }),
    );
  }

  async loadOpenPositions(): Promise<SavedPosition[]> {
    await this.flush();
    const rows = await this.db
      .select()
      .from(tradingPositions)
      .where(inArray(tradingPositions.status, ['opening', 'open']));
    return rows.flatMap((row) => {
      const stored = storedPositionSchema.safeParse(row.position);
      const status = savedStatusSchema.safeParse(row.status);
      if (!stored.success || !status.success) {
        this.logger.error({ message: 'unreadable saved position', id: row.id });
        return [];
      }
      const { entryRefPrice, ...position } = stored.data;
      return [
        { runId: row.runId, status: status.data, position, entryRefPrice },
      ];
    });
  }

  flush(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  private write(kind: string, task: () => PromiseLike<unknown>): void {
    this.pending += 1;
    this.queue = this.queue
      .then(task)
      .catch((error: unknown) => {
        this.logger.error({
          message: 'write failed',
          kind,
          error: String(error),
        });
      })
      .finally(() => {
        this.pending -= 1;
      });
  }
}

function tickerOf(event: EngineEvent): string {
  switch (event.type) {
    case 'order':
      return event.order.ticker;
    case 'positionOpened':
      return event.position.ticker;
    case 'positionClosed':
      return event.trade.ticker;
    default:
      return event.ticker;
  }
}

function mergeDay(
  existing: typeof tradingDays.$inferSelect,
  record: DayRecord,
): DayRecord {
  const signals = new Map(
    signalRowsSchema
      .parse(existing.signals)
      .map((row) => [signalKey(row), row]),
  );
  for (const row of record.signals) signals.set(signalKey(row), row);
  const trades = new Map(
    tradeRowsSchema.parse(existing.trades).map((row) => [tradeKey(row), row]),
  );
  for (const row of record.trades) trades.set(tradeKey(row), row);
  const mergedTrades = [...trades.values()];
  return {
    ...record,
    runIds: [
      ...new Set([...stringsSchema.parse(existing.runIds), ...record.runIds]),
    ],
    signals: [...signals.values()],
    trades: mergedTrades,
    netPnl: mergedTrades.reduce((sum, trade) => sum + trade.netPnl, 0),
    dataHealth: {
      ...objectSchema.parse(existing.dataHealth),
      ...record.dataHealth,
    },
    account: record.account ?? existing.account,
  };
}
