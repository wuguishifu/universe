import {
  Bar,
  calendarFromDays,
  EngineEvent,
  MINUTE_MS,
  multiplierOf,
  Position,
  StrategyConfig,
  StrategyConfigInput,
  Trade,
  TradingEngine,
  worstCasePricePath,
} from '@projects/trading-core';

import { MarketData } from '../data/data-store';

import { HistoricalChains } from './historical-chains';
import { modelQuote } from './quotes';
import { MarketPrice, SimulatedBroker } from './simulated-broker';
import { SimulationConfig } from './simulation-config';

export type BacktestTrade = Trade & {
  /** Fees for both the buy and the sell. */
  fees: number;
  netPnl: number;
};

export type EquityPoint = { time: number; equity: number };

export type DaySummary = {
  date: string;
  trades: number;
  netPnl: number;
  equity: number;
};

export type BacktestInput = {
  strategy: StrategyConfigInput;
  simulation: SimulationConfig;
  store: MarketData;
  /** First and last trading day to trade, `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  onDay?: (day: DaySummary) => void;
};

export type BacktestResult = {
  strategy: StrategyConfig;
  simulation: SimulationConfig;
  from: string;
  to: string;
  days: DaySummary[];
  trades: BacktestTrade[];
  /** Equity after every fill and at the end of every day. */
  equity: EquityPoint[];
  /** Everything the engine reported except per-bar snapshots. */
  events: EngineEvent[];
  /** Positions still held when the data ran out. */
  openPositions: Position[];
  warnings: string[];
};

/** Offsets within a minute for the four prices replayed from each option bar. */
const PATH_OFFSETS_MS = [0, 15_000, 30_000, 45_000];

/**
 * Replays history through the trading engine one minute at a time. For each minute:
 *
 * 1. Every option the engine holds is quoted along its bar's worst-case path (open, low, high,
 *    close), with the modeled spread around each price.
 * 2. Each ticker's 1-minute underlying bar is delivered, which is when signals fire.
 *
 * Orders fill immediately through the simulated broker.
 */
export async function runBacktest(
  input: BacktestInput,
): Promise<BacktestResult> {
  const { store, simulation, from, to } = input;
  const calendarDays = store.calendar();
  const chains = new HistoricalChains(simulation);
  const engine = new TradingEngine({
    config: input.strategy,
    chains,
    calendar: calendarFromDays(calendarDays),
    orderIdPrefix: 'bt-',
  });
  const broker = new SimulatedBroker(simulation);
  const { tickers } = engine.config;

  const tradingDays = calendarDays.map((day) => day.date);
  const days = tradingDays.filter((date) => date >= from && date <= to);
  const [firstDay] = days;
  if (!firstDay)
    throw new Error(
      `No trading days in the calendar between ${from} and ${to}`,
    );

  const warnings: string[] = [];
  const firstIndex = tradingDays.indexOf(firstDay);
  for (const date of tradingDays.slice(
    Math.max(0, firstIndex - simulation.warmupDays),
    firstIndex,
  )) {
    for (const ticker of tickers) {
      const bars = store.stockBars(ticker, date);
      if (bars) await engine.warmup(ticker, bars);
      else warnings.push(`No ${ticker} bars for warmup day ${date}`);
    }
  }

  const trades: BacktestTrade[] = [];
  const events: EngineEvent[] = [];
  const equity: EquityPoint[] = [];
  const summaries: DaySummary[] = [];
  engine.setEquity(broker.equity([]));

  let options = new OptionBarIndex();
  const handle = async (batch: readonly EngineEvent[]): Promise<void> => {
    for (const event of batch) {
      if (event.type === 'bar') continue;
      events.push(event);

      if (event.type === 'order') {
        const position = engine
          .getPositions()
          .find((p) => p.id === event.order.positionId);
        const multiplier = position
          ? multiplierOf(position.contract)
          : undefined;
        await handle(
          await engine.onOrderUpdate(
            broker.fill(
              event.order,
              multiplier,
              options.firstPriceAtOrAfter(
                event.order.symbol,
                event.order.time,
                simulation.maxPriceAgeMinutes * MINUTE_MS,
              ),
            ),
          ),
        );
        const value = broker.equity(engine.getPositions());
        engine.setEquity(value);
        equity.push({ time: event.order.time, equity: value });
      } else if (
        event.type === 'positionClosed' ||
        event.type === 'exitFailed'
      ) {
        if (event.trade) {
          const fees = simulation.feePerContract * event.trade.qty * 2;
          trades.push({ ...event.trade, fees, netPnl: event.trade.pnl - fees });
        }
      }
    }
  };

  for (const date of days) {
    const stock = new Map<string, Map<number, Bar>>();
    options = new OptionBarIndex();
    const minutes = new Set<number>();

    for (const ticker of tickers) {
      const bars = store.stockBars(ticker, date);
      if (!bars) {
        warnings.push(`No ${ticker} bars on ${date}`);
        continue;
      }
      stock.set(ticker, new Map(bars.map((bar) => [bar.time, bar])));
      for (const bar of bars) minutes.add(bar.time);

      const optionBars = store.optionBars(ticker, date);
      if (!optionBars) warnings.push(`No ${ticker} option bars on ${date}`);
      chains.load(ticker, optionBars ?? new Map());
      options.load(optionBars ?? new Map());
    }

    const tradesBefore = trades.length;
    let lastMinute = 0;
    for (const minute of [...minutes].sort((a, b) => a - b)) {
      lastMinute = minute;
      const held = new Set(
        engine
          .getPositions()
          .filter((p) => p.status === 'open')
          .map((p) => p.contract.symbol),
      );
      for (const symbol of held) {
        const bar = options.at(symbol, minute);
        if (!bar) continue;
        const path = worstCasePricePath(bar);
        for (const [i, price] of path.entries()) {
          const quote = modelQuote(price, simulation);
          const time = minute + (PATH_OFFSETS_MS[i] ?? 0);
          await handle(await engine.onQuote({ symbol, time, ...quote }));
        }
      }

      for (const ticker of tickers) {
        const bar = stock.get(ticker)?.get(minute);
        if (bar) await handle(await engine.onBar(ticker, bar));
      }
    }

    const value = broker.equity(engine.getPositions());
    engine.setEquity(value);
    equity.push({ time: lastMinute + 60_000, equity: value });
    const dayTrades = trades.slice(tradesBefore);
    const summary: DaySummary = {
      date,
      trades: dayTrades.length,
      netPnl: dayTrades.reduce((sum, trade) => sum + trade.netPnl, 0),
      equity: value,
    };
    summaries.push(summary);
    input.onDay?.(summary);

    const leftOpen = engine.getPositions().length;
    if (leftOpen > 0)
      warnings.push(`${leftOpen} position(s) still open after ${date}`);
  }

  return {
    strategy: engine.config,
    simulation,
    from,
    to,
    days: summaries,
    trades,
    equity,
    events,
    openPositions: engine.getPositions(),
    warnings,
  };
}

/** Looks up an option's bar for a given minute, indexing each symbol only once it's needed. */
export class OptionBarIndex {
  private raw = new Map<string, Bar[]>();
  private indexed = new Map<string, Map<number, Bar>>();

  load(barsBySymbol: ReadonlyMap<string, Bar[]>): void {
    for (const [symbol, bars] of barsBySymbol) {
      this.raw.set(symbol, bars);
      this.indexed.delete(symbol);
    }
  }

  /**
   * The first replayed price (see PATH_OFFSETS_MS) at or after `time`, looking at most `maxWaitMs`
   * ahead. This is where a market order sent at `time` would fill.
   */
  firstPriceAtOrAfter(
    symbol: string,
    time: number,
    maxWaitMs: number,
  ): MarketPrice | undefined {
    const firstMinute = Math.floor(time / MINUTE_MS) * MINUTE_MS;
    for (
      let minute = firstMinute;
      minute <= time + maxWaitMs;
      minute += MINUTE_MS
    ) {
      const bar = this.at(symbol, minute);
      if (!bar) continue;
      for (const [i, price] of worstCasePricePath(bar).entries()) {
        const at = minute + (PATH_OFFSETS_MS[i] ?? 0);
        if (at >= time) return { price, time: at };
      }
    }
    return undefined;
  }

  at(symbol: string, minute: number): Bar | undefined {
    let index = this.indexed.get(symbol);
    if (!index) {
      index = new Map(
        (this.raw.get(symbol) ?? []).map((bar) => [bar.time, bar]),
      );
      this.indexed.set(symbol, index);
    }
    return index.get(minute);
  }
}
