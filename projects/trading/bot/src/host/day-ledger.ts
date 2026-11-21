import {
  EngineEvent,
  IndicatorValues,
  nyTime,
  OrderIntent,
  Trade,
} from '@projects/trading-core';

import {
  DayRecord,
  OptionsFeed,
  RecordedTrade,
  SignalRow,
  StockFeed,
} from './ports';

/**
 * Builds one trading day's forward-test record from what the engine reports: each signal and what
 * came of it, each trade against the prices the engine decided on, and the data's health.
 */
export class DayLedger {
  readonly date: string;
  private readonly runId: string;
  private readonly feeds: { stock: StockFeed; options: OptionsFeed };
  private readonly feePerContract: number;
  private readonly signals: SignalRow[] = [];
  private readonly trades: RecordedTrade[] = [];
  private readonly intents = new Map<string, OrderIntent>();
  private readonly signalByPosition = new Map<string, SignalRow>();
  /** Entry reference prices for positions restored from an earlier run. */
  private readonly restoredRefs = new Map<string, number>();
  private lastIndicators:
    { close: number; indicators: IndicatorValues } | undefined;
  readonly health: Record<string, number> = {};
  account: unknown;

  constructor(options: {
    date: string;
    runId: string;
    stockFeed: StockFeed;
    optionsFeed: OptionsFeed;
    feePerContract: number;
  }) {
    this.date = options.date;
    this.runId = options.runId;
    this.feeds = { stock: options.stockFeed, options: options.optionsFeed };
    this.feePerContract = options.feePerContract;
  }

  count(key: string, by = 1): void {
    this.health[key] = (this.health[key] ?? 0) + by;
  }

  restored(positionId: string, entryRefPrice: number | undefined): void {
    if (entryRefPrice !== undefined)
      this.restoredRefs.set(positionId, entryRefPrice);
  }

  /** The host refused to place an entry the engine asked for. */
  blocked(intentId: string, reason: string): void {
    const intent = this.intents.get(intentId);
    const row = intent && this.signalByPosition.get(intent.positionId);
    if (row) {
      row.outcome = 'blockedByHost';
      row.reason = reason;
    }
  }

  entryRefPrice(positionId: string): number | undefined {
    const row = this.signalByPosition.get(positionId);
    return row?.refPrice ?? this.restoredRefs.get(positionId);
  }

  /** Returns a trade to record when the event closed one. */
  onEvent(event: EngineEvent): RecordedTrade | undefined {
    switch (event.type) {
      case 'bar':
        this.lastIndicators = {
          close: event.snapshot.bar.close,
          indicators: event.snapshot.indicators,
        };
        return undefined;
      case 'signal':
        this.signals.push({
          direction: event.direction,
          time: event.time,
          outcome: 'skipped',
          ...this.lastIndicators,
        });
        return undefined;
      case 'entrySkipped': {
        const row = this.signalAt(event.time);
        if (row) row.reason = event.reason;
        return undefined;
      }
      case 'order': {
        const { order } = event;
        this.intents.set(order.id, order);
        if (order.action === 'open') {
          const row = this.signalAt(order.time);
          if (row) {
            row.outcome = 'ordered';
            row.symbol = order.symbol;
            row.refPrice = order.refPrice;
            this.signalByPosition.set(order.positionId, row);
          }
        }
        return undefined;
      }
      case 'positionOpened': {
        const row = this.signalByPosition.get(event.position.id);
        if (row) {
          row.outcome = 'entered';
          row.fillPrice = event.position.entryPrice;
          row.filledQty = event.position.qty;
          if (row.refPrice !== undefined)
            row.slippage = event.position.entryPrice - row.refPrice;
        }
        return undefined;
      }
      case 'entryFailed': {
        const intent = this.intents.get(event.orderId);
        const row = intent && this.signalByPosition.get(intent.positionId);
        if (row && row.outcome !== 'blockedByHost') {
          row.outcome = 'entryFailed';
          row.reason = `entry ${event.status}`;
        }
        return undefined;
      }
      case 'positionClosed':
        return this.addTrade(event.trade, event.trade.positionId);
      case 'exitFailed':
        return event.trade
          ? this.addTrade(event.trade, event.trade.positionId)
          : undefined;
    }
    return undefined;
  }

  toRecord(dataHealth: Record<string, unknown> = {}): DayRecord {
    return {
      date: this.date,
      runIds: [this.runId],
      stockFeed: this.feeds.stock,
      optionsFeed: this.feeds.options,
      signals: this.signals,
      trades: this.trades,
      netPnl: this.trades.reduce((sum, trade) => sum + trade.netPnl, 0),
      dataHealth: { [this.runId]: { ...this.health, ...dataHealth } },
      account: this.account,
    };
  }

  private addTrade(trade: Trade, positionId: string): RecordedTrade {
    const closeIntent = [...this.intents.values()]
      .filter((i) => i.action === 'close' && i.positionId === positionId)
      .at(-1);
    const entryRefPrice = this.entryRefPrice(positionId);
    const exitRefPrice = closeIntent?.refPrice;
    const fees = this.feePerContract * trade.qty * 2;
    const recorded: RecordedTrade = {
      ...trade,
      runId: this.runId,
      tradeDate: nyTime(trade.exitTime).date,
      entryRefPrice,
      exitRefPrice,
      entrySlippage:
        entryRefPrice === undefined
          ? undefined
          : trade.entryPrice - entryRefPrice,
      exitSlippage:
        exitRefPrice === undefined ? undefined : exitRefPrice - trade.exitPrice,
      fees,
      netPnl: trade.pnl - fees,
    };
    this.trades.push(recorded);
    return recorded;
  }

  private signalAt(time: number): SignalRow | undefined {
    return [...this.signals].reverse().find((row) => row.time === time);
  }
}
