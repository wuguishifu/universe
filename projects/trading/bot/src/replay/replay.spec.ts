import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EngineEvent, nyTime } from '@projects/trading-core';

import { nyEpochAt } from '../host/ny-clock';

import { ReplayBroker } from './fakes';
import { loadFixture, quoteAt, ReplayFixture } from './fixture';
import { decisions, replay } from './replay';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/premarket-box-qqq.json.gz', import.meta.url),
);

/**
 * The bot's host, driven through recorded days with fake Alpaca clients, has to make the same
 * decisions as `backtest run --config configs/premarket-box-qqq.json` on the same days: the same
 * signals, skips, contracts, exit reasons and times, and (filling at the same real quotes) the
 * same prices. The fixture's expectations come from that command; see build-fixture.ts.
 *
 * 2025-11-24 → 12-02: filter-blocked days (11-24, 11-25), stops (11-26, and 11-28, a 13:00 early
 * close), a 15:55 flat (12-01) and a target (12-02). 2025-07-01 → 07-03: blocked days, then an
 * early close flattened at 12:55.
 */
describe('replay against the backtest', () => {
  let fixture: ReplayFixture;
  before(() => {
    fixture = loadFixture(FIXTURE);
  });

  const windowAt = (i: number) => {
    const window = fixture.windows[i];
    assert.ok(window);
    return window;
  };

  it("makes the backtest's decisions, Nov 24 – Dec 2 2025", async () => {
    const window = windowAt(0);
    const { recorder } = await replay(fixture, window);
    assert.deepEqual(
      decisions(botEvents(recorder.events)),
      decisions(window.expected),
    );
  });

  it("makes the backtest's decisions, Jul 1 – 3 2025", async () => {
    const window = windowAt(1);
    const { recorder } = await replay(fixture, window);
    assert.deepEqual(
      decisions(botEvents(recorder.events)),
      decisions(window.expected),
    );
  });

  it('covers a stop, a target, a blocked day and early closes', () => {
    const lines = [...windowAt(0).expected, ...windowAt(1).expected];
    const reasons = lines.flatMap((e) =>
      e.type === 'positionClosed' ? [e.trade.reason] : [],
    );
    assert.ok(reasons.includes('underlyingStop'));
    assert.ok(reasons.includes('underlyingTarget'));
    assert.ok(reasons.includes('flatBeforeClose'));
    assert.ok(
      lines.some(
        (e) =>
          e.type === 'entrySkipped' && e.reason === 'blocked by indicatorSide',
      ),
    );
    const earlyFlat = lines.find(
      (e) =>
        e.type === 'positionClosed' &&
        nyTime(e.trade.exitTime).date === '2025-07-03',
    );
    assert.ok(earlyFlat?.type === 'positionClosed');
    assert.equal(nyTime(earlyFlat.trade.exitTime).minute, 12 * 60 + 55);
  });

  it('writes a day record with each signal, fill, slippage and P&L', async () => {
    const { recorder } = await replay(fixture, {
      from: '2025-11-24',
      to: '2025-11-26',
    });

    const blocked = recorder.days.get('2025-11-24');
    assert.deepEqual(
      blocked?.signals.map(({ direction, outcome, reason }) => ({
        direction,
        outcome,
        reason,
      })),
      [
        {
          direction: 'bullish',
          outcome: 'skipped',
          reason: 'blocked by indicatorSide',
        },
      ],
    );

    const stopped = recorder.days.get('2025-11-26');
    assert.ok(stopped);
    const [signal] = stopped.signals;
    assert.equal(signal?.outcome, 'entered');
    assert.equal(signal?.symbol, 'QQQ251128C00613000');
    // Filled at the ask the engine decided on, as the fake broker does.
    assert.equal(signal?.slippage, 0);
    assert.ok(
      signal?.indicators?.['boxHigh'] !== undefined &&
        signal.indicators['boxLow'] !== undefined,
    );

    const [trade] = recorder.trades.filter((t) => t.tradeDate === '2025-11-26');
    assert.equal(trade?.reason, 'underlyingStop');
    assert.equal(trade?.entryRefPrice, 3.06);
    assert.equal(trade?.exitRefPrice !== undefined, true);
    assert.equal(Math.round((trade?.netPnl ?? 0) * 100) / 100, -104.1);
    assert.equal(Math.round(stopped.netPnl * 100) / 100, -104.1);
  });
});

describe('restarts', () => {
  let fixture: ReplayFixture;
  before(() => {
    fixture = loadFixture(FIXTURE);
  });
  const TARGET_DAY = '2025-12-02';

  it('restores a position held through a crash and still exits at the target', async () => {
    const expected = fixture.windows[0]?.expected.filter(
      (e) => eventDate(e) === TARGET_DAY,
    );
    assert.ok(expected);
    const { recorder, broker } = await replay(
      fixture,
      { from: TARGET_DAY, to: TARGET_DAY },
      {
        crash: {
          at: nyEpochAt(TARGET_DAY, '09:45'),
          restartAt: nyEpochAt(TARGET_DAY, '09:55'),
        },
      },
    );
    assert.deepEqual(
      decisions(botEvents(recorder.events)),
      decisions(expected),
    );
    assert.ok(recorder.incidents.some((i) => i.kind === 'restored'));
    assert.deepEqual(await broker.listPositions(), []);
    // The restart's day record knows the entry's reference price, so slippage survives.
    const [trade] = recorder.trades;
    assert.equal(trade?.reason, 'underlyingTarget');
    assert.equal(trade?.entryRefPrice, 3);
  });

  it('flattens a position whose target was hit while the bot was down', async () => {
    const { recorder, broker } = await replay(
      fixture,
      { from: TARGET_DAY, to: TARGET_DAY },
      {
        crash: {
          at: nyEpochAt(TARGET_DAY, '09:45'),
          restartAt: nyEpochAt(TARGET_DAY, '10:30'),
        },
      },
    );
    const missed = recorder.incidents.find(
      (i) => i.kind === 'missedExitWhileDown',
    );
    assert.equal(field(missed?.details, 'reason'), 'underlyingTarget');
    assert.ok(
      recorder.incidents.some((i) => i.kind === 'flattenedOutsideEngine'),
    );
    assert.deepEqual(await broker.listPositions(), []);
  });

  it('flattens a holding it has no record of, and leaves foreign ones alone', async () => {
    const day = '2025-11-24';
    const prepareAt = nyEpochAt(day, '09:34');
    // Any contract the fixture can quote then.
    const [orphan] =
      Object.entries(fixture.quotes[day] ?? {}).find(
        ([symbol, rows]) =>
          symbol.startsWith('QQQ251125C') && quoteAt(rows, prepareAt),
      ) ?? [];
    assert.ok(orphan);
    const { recorder, broker } = await replay(
      fixture,
      { from: day, to: day },
      {
        settings: { prepareAt: '09:34' },
        makeBroker: (quotes, timers) => {
          const b = new ReplayBroker(quotes, timers);
          b.hold(orphan, 2, 3);
          b.hold('SPY251125C00660000', 1, 2);
          return b;
        },
        afterBar: (_host, bar) => bar.time >= nyEpochAt(day, '09:40'),
      },
    );
    assert.ok(recorder.incidents.some((i) => i.kind === 'unexplainedHolding'));
    assert.ok(recorder.incidents.some((i) => i.kind === 'foreignHolding'));
    const left = (await broker.listPositions()).map((p) => p.symbol);
    assert.deepEqual(left, ['SPY251125C00660000']);
  });
});

describe('account rules', () => {
  it('records the entry as blocked when another day trade would break the PDT rule', async () => {
    const fixture = loadFixture(FIXTURE);
    const day = '2025-11-26';
    const { recorder, broker } = await replay(
      fixture,
      { from: day, to: day },
      {
        makeBroker: (quotes, timers) => {
          const b = new ReplayBroker(quotes, timers);
          b.account = { ...b.account, equity: 20_000, daytradeCount: 3 };
          return b;
        },
      },
    );
    assert.equal(broker.requests.length, 0);
    const [signal] = recorder.days.get(day)?.signals ?? [];
    assert.equal(signal?.outcome, 'blockedByHost');
    assert.match(String(signal?.reason), /pattern day trader/);
    assert.ok(
      recorder.incidents.some((i) => i.kind === 'accountBlocksEntries'),
    );
  });
});

describe('shutdown', () => {
  it('sells everything at market', async () => {
    const fixture = loadFixture(FIXTURE);
    const day = '2025-12-01';
    let shutDown = false;
    const { recorder, broker } = await replay(
      fixture,
      { from: day, to: day },
      {
        afterBar: async (host, bar) => {
          if (bar.time < nyEpochAt(day, '11:00')) return false;
          await host.shutdown('test');
          shutDown = true;
          return true;
        },
      },
    );
    assert.ok(shutDown);
    const [trade] = recorder.trades;
    assert.equal(trade?.reason, 'forced');
    assert.deepEqual(await broker.listPositions(), []);
    const sells = broker.requests.filter((r) => r.side === 'sell');
    assert.equal(sells.at(-1)?.type, 'market');
  });
});

function botEvents(
  events: ReadonlyArray<{ event: EngineEvent }>,
): EngineEvent[] {
  return events.map((e) => e.event).filter((e) => e.type !== 'bar');
}

function eventDate(event: EngineEvent): string | undefined {
  switch (event.type) {
    case 'signal':
    case 'entrySkipped':
      return nyTime(event.time).date;
    case 'order':
      return nyTime(event.order.time).date;
    case 'positionOpened':
      return nyTime(event.position.entryTime).date;
    case 'positionClosed':
      return nyTime(event.trade.exitTime).date;
    default:
      return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;
}
