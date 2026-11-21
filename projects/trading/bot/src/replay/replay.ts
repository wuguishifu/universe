import {
  Bar,
  EngineEvent,
  MINUTE_MS,
  nyTime,
  PREMARKET_BOX_BREAKOUT,
  StrategyConfigInput,
} from '@projects/trading-core';

import { nyEpochAt } from '../host/ny-clock';
import { silentLog } from '../host/ports';
import { HostSettingsInput, hostSettingsSchema } from '../host/settings';
import { TradingHost } from '../host/trading-host';

import {
  FixtureMarketData,
  MemoryRecorder,
  QuoteBook,
  ReplayBroker,
  ReplayTimers,
} from './fakes';
import { ReplayFixture, toBar } from './fixture';

export type ReplayOptions = {
  strategy?: StrategyConfigInput;
  settings?: HostSettingsInput;
  runId?: string;
  /** Called after each host is prepared, before its first live bar. */
  onPrepared?: (host: TradingHost, date: string) => void | Promise<void>;
  /** Called after each bar is handled. Return true to end the day there. */
  afterBar?: (
    host: TradingHost,
    bar: Bar,
  ) => boolean | void | Promise<boolean | void>;
  /**
   * Kills the host without shutting it down once a bar at or after `at` has been handled, as a
   * crash would. With `restartAt`, a new host (a new run) is prepared then and the day goes on.
   */
  crash?: { at: number; restartAt?: number };
  /** To fill differently, or to start with positions on the books. */
  makeBroker?: (quotes: QuoteBook, timers: ReplayTimers) => ReplayBroker;
  recorder?: MemoryRecorder;
};

/**
 * Drives the bot's own host code through recorded days, the way the backtester drives the engine:
 * each minute, held options get the quote standing at the start of the minute, then the 1-minute
 * bar arrives when it closes. A fresh host is prepared at `prepareAt` each day, as live.
 */
export async function replay(
  fixture: ReplayFixture,
  window: { from: string; to: string },
  options: ReplayOptions = {},
) {
  const settings = hostSettingsSchema.parse(options.settings ?? {});
  const days = fixture.calendar
    .map((day) => day.date)
    .filter((date) => date >= window.from && date <= window.to);
  const [first] = days;
  if (!first)
    throw new Error(`No trading days in ${window.from}..${window.to}`);

  const timers = new ReplayTimers(nyEpochAt(first, settings.prepareAt));
  const quotes = new QuoteBook(fixture);
  const data = new FixtureMarketData(fixture, quotes, timers);
  const broker =
    options.makeBroker?.(quotes, timers) ?? new ReplayBroker(quotes, timers);
  const recorder = options.recorder ?? new MemoryRecorder();

  let runs = 0;
  const startHost = async (date: string): Promise<TradingHost> => {
    runs += 1;
    const host = new TradingHost({
      runId: `${options.runId ?? 'tb-replay'}${runs > 1 ? runs : ''}`,
      strategy: options.strategy ?? PREMARKET_BOX_BREAKOUT,
      settings,
      broker,
      data,
      recorder,
      timers,
      log: silentLog,
      live: false,
    });
    broker.onUpdate = (event, order) =>
      host.onTradeUpdate(event, order, timers.now(), order);
    await host.prepare(date);
    await options.onPrepared?.(host, date);
    return host;
  };

  for (const date of days) {
    const prepareAt = nyEpochAt(date, settings.prepareAt);
    timers.advanceTo(prepareAt);
    let host: TradingHost | undefined = await startHost(date);
    const firstRun = runs;

    for (const row of fixture.bars[date] ?? []) {
      const bar = toBar(row);
      if (bar.time < prepareAt) continue; // fed by warmup
      if (!host) {
        // Down: bars go by unseen until the restart, whose warmup then picks them up.
        const restartAt = options.crash?.restartAt;
        if (restartAt === undefined || bar.time < restartAt) continue;
        timers.advanceTo(restartAt);
        host = await startHost(date);
      }
      timers.advanceTo(bar.time + MINUTE_MS);
      for (const position of host.positions) {
        if (position.status !== 'open') continue;
        const quote = quotes.at(position.contract.symbol, bar.time);
        if (quote) await host.onQuote({ ...quote, time: bar.time });
      }
      await host.onStreamBar(bar);
      await host.idle();
      if (await options.afterBar?.(host, bar)) break;
      if (options.crash && runs === firstRun && bar.time >= options.crash.at)
        host = undefined;
    }
    await host?.endDay();
  }
  return { recorder, broker, data, timers };
}

const nyMinute = (time: number): string => {
  const { date, minute } = nyTime(time);
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(Math.floor(minute % 60)).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
};

/**
 * The decisions in a list of engine events, one readable line each, to compare runs by. Times are
 * to the minute: the bot's fills land a few simulated seconds after the decision while it works
 * its limit orders, the backtest's at the decision itself.
 */
export function decisions(events: readonly EngineEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'signal':
        lines.push(`${nyMinute(event.time)} signal ${event.direction}`);
        break;
      case 'entrySkipped':
        lines.push(
          `${nyMinute(event.time)} skip ${event.direction}: ${event.reason}`,
        );
        break;
      case 'order': {
        const o = event.order;
        lines.push(
          `${nyMinute(o.time)} ${o.action} ${o.symbol} x${o.qty} ref ${o.refPrice.toFixed(2)}${o.reason ? ` (${o.reason})` : ''}`,
        );
        break;
      }
      case 'positionOpened': {
        const p = event.position;
        lines.push(
          `${nyMinute(p.entryTime)} opened ${p.contract.symbol} x${p.qty} @ ${p.entryPrice.toFixed(2)}`,
        );
        break;
      }
      case 'positionClosed': {
        const t = event.trade;
        lines.push(
          `${nyMinute(t.exitTime)} closed ${t.symbol} x${t.qty} @ ${t.exitPrice.toFixed(2)} ${t.reason} pnl ${t.pnl.toFixed(2)}`,
        );
        break;
      }
      case 'entryFailed':
      case 'exitFailed':
        lines.push(`${event.type} ${event.status}`);
        break;
    }
  }
  return lines;
}
