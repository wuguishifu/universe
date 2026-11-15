import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DataStore } from '../data/data-store';
import { nyLocalToEpoch, quoteAt, QuoteCollector } from '../data/theta';

import {
  clockMinus,
  coverage,
  downloadQuotes,
  strikesEitherSide,
  strikeWindow,
} from './download-quotes';
import { OptionQuoteRequest, ThetaClient } from './theta-client';

const HEADER =
  'symbol,expiration,strike,right,timestamp,bid_size,bid_exchange,bid,bid_condition,ask_size,ask_exchange,ask,ask_condition';
const row = (
  strike: number,
  right: string,
  time: string,
  bid: number,
  ask: number,
  expiration = '2024-11-04',
): string =>
  `SPY,${expiration},${strike.toFixed(3)},${right},2024-11-04T${time}.000,10,5,${bid},50,12,7,${ask},50`;

const collect = (lines: string[], maxExpiration = '2024-11-11') => {
  const collector = new QuoteCollector({
    minStrike: 560,
    maxStrike: 580,
    maxExpiration,
  });
  for (const line of [HEADER, ...lines]) collector.push(line);
  return collector;
};

describe('nyLocalToEpoch', () => {
  it('reads winter and summer timestamps as New York time', () => {
    assert.equal(
      nyLocalToEpoch('2024-11-04T09:30:00.000'),
      Date.parse('2024-11-04T09:30:00-05:00'),
    );
    assert.equal(
      nyLocalToEpoch('2024-07-01T15:58:00.000'),
      Date.parse('2024-07-01T15:58:00-04:00'),
    );
  });

  it('is NaN for anything else', () => {
    assert.ok(Number.isNaN(nyLocalToEpoch('nope')));
  });
});

describe('QuoteCollector', () => {
  it('keys quotes by OCC symbol and keeps only the changes', () => {
    const quotes = collect([
      row(570, 'CALL', '15:00:00', 1.2, 1.22),
      row(570, 'CALL', '15:01:00', 1.2, 1.22),
      row(570, 'CALL', '15:02:00', 1.25, 1.27),
      row(570, 'PUT', '15:00:00', 0.8, 0.81),
    ]).result();
    const at = (time: string) => Date.parse(`2024-11-04T${time}-05:00`);
    assert.deepEqual(quotes, {
      SPY241104C00570000: [
        [at('15:00:00'), 1.2, 1.22],
        [at('15:02:00'), 1.25, 1.27],
      ],
      SPY241104P00570000: [[at('15:00:00'), 0.8, 0.81]],
    });
  });

  it('drops strikes and expirations outside the filter, and empty quotes', () => {
    const collector = collect([
      row(559, 'C', '15:00:00', 9, 9.1),
      row(581, 'C', '15:00:00', 0.01, 0.02),
      row(570, 'C', '15:00:00', 1, 1.1, '2024-11-12'),
      row(570, 'C', '15:00:00', 0, 0),
      row(580, 'P', '15:00:00', 0, 0.01),
    ]);
    assert.deepEqual(Object.keys(collector.result()), ['SPY241104P00580000']);
    assert.equal(collector.rows, 5);
    assert.equal(collector.malformed, 0);
  });

  it('finds columns by name, whatever their order', () => {
    const collector = new QuoteCollector({
      minStrike: 0,
      maxStrike: 1000,
      maxExpiration: '2030-01-01',
    });
    collector.push('ask,bid,timestamp,right,strike,expiration,symbol');
    collector.push('1.1,1.0,2024-11-04T10:00:00.000,put,570.5,20241108,QQQ');
    assert.deepEqual(Object.keys(collector.result()), ['QQQ241108P00570500']);
  });

  it('counts lines it cannot read and rejects a response without the columns', () => {
    const collector = collect([
      'SPY,2024-11-04,abc,CALL,whenever,1,1,x,1,1,1,y,1',
    ]);
    assert.equal(collector.malformed, 1);
    assert.throws(
      () =>
        new QuoteCollector({
          minStrike: 0,
          maxStrike: 1,
          maxExpiration: '',
        }).push('{"error":"something else"}'),
      /no "symbol" column/,
    );
  });
});

describe('quoteAt', () => {
  it('is the last change at or before the time', () => {
    const rows: Array<[number, number, number]> = [
      [100, 1, 1.1],
      [200, 2, 2.1],
    ];
    assert.equal(quoteAt(rows, 99), undefined);
    assert.deepEqual(quoteAt(rows, 100), [100, 1, 1.1]);
    assert.deepEqual(quoteAt(rows, 199), [100, 1, 1.1]);
    assert.deepEqual(quoteAt(rows, 5000), [200, 2, 2.1]);
  });
});

describe('strike window', () => {
  it('matches the bar download and sizes the request for the worst case', () => {
    const range = { low: 565.4, high: 571.2 };
    assert.deepEqual(strikeWindow(range, 10), {
      minStrike: 555,
      maxStrike: 582,
    });
    // From either end of the day's range, 18 one-dollar strikes reach past the other end's padding.
    assert.equal(strikesEitherSide(range, 10, 1), 18);
  });
});

describe('ThetaClient', () => {
  it('asks for one day of 1-minute quotes across every expiration', () => {
    const url = new ThetaClient().optionQuotesUrl({
      symbol: 'SPY',
      date: '2024-11-04',
      maxDte: 7,
      strikeRange: 18,
      startTime: '09:30:00',
      endTime: '16:00:00',
    });
    assert.equal(
      url.origin + url.pathname,
      'http://127.0.0.1:25503/v3/option/history/quote',
    );
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      symbol: 'SPY',
      expiration: '*',
      date: '20241104',
      interval: '1m',
      start_time: '09:30:00',
      end_time: '16:00:00',
      max_dte: '7',
      strike_range: '18',
      format: 'csv',
    });
  });
});

describe('downloadQuotes', () => {
  it('writes a day, reports coverage, and skips it next time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quotes-'));
    const date = '2024-11-04';
    writeFileSync(
      join(dir, 'calendar.json'),
      JSON.stringify([{ date, open: '09:30', close: '16:00' }]),
    );
    const bar = {
      t: `${date}T20:00:00Z`,
      o: 570,
      h: 571,
      l: 569,
      c: 570,
      v: 1,
    };
    mkdirSync(join(dir, 'stocks', 'SPY'), { recursive: true });
    writeFileSync(
      join(dir, 'stocks', 'SPY', `${date}.json`),
      JSON.stringify([bar]),
    );
    mkdirSync(join(dir, 'options', 'SPY'), { recursive: true });
    writeFileSync(
      join(dir, 'options', 'SPY', `${date}.json`),
      JSON.stringify({ SPY241104C00570000: [bar], SPY241104P00565000: [bar] }),
    );

    const requests: OptionQuoteRequest[] = [];
    const client = {
      optionQuotes: (
        request: OptionQuoteRequest,
        begin: () => void,
        onLine: (line: string) => void,
      ) => {
        requests.push(request);
        begin();
        for (const line of [HEADER, row(570, 'CALL', '15:00:00', 1.2, 1.22)])
          onLine(line);
        return Promise.resolve(true);
      },
    };
    const log: string[] = [];
    const options = {
      client,
      dir,
      tickers: ['SPY'],
      from: date,
      to: date,
      expiryDays: 7,
      strikePadding: 10,
      strikeStep: 1,
      narrowRequest: true,
      concurrency: 2,
      log: (line: string) => log.push(line),
    };
    await downloadQuotes(options);

    assert.deepEqual(requests, [
      {
        symbol: 'SPY',
        date,
        maxDte: 7,
        startTime: '09:30:00',
        endTime: '16:00:00',
        strikeRange: 14,
      },
    ]);
    assert.deepEqual(new DataStore(dir).optionQuotes('SPY', date), {
      SPY241104C00570000: [[Date.parse(`${date}T15:00:00-05:00`), 1.2, 1.22]],
    });
    assert.match(log.join('\n'), /quotes for 1 of 2 traded contracts/);
    assert.match(log.join('\n'), /rerun with --full-chain/);

    await downloadQuotes(options);
    assert.equal(requests.length, 1);
  });

  it('counts coverage', () => {
    assert.deepEqual(coverage(['A', 'B'], { A: [[1, 1, 2]], B: [] }), {
      traded: 2,
      quoted: 1,
    });
  });
});

describe('clockMinus', () => {
  it('handles full and early closes', () => {
    assert.equal(clockMinus('16:00', 15), '15:45:00');
    assert.equal(clockMinus('13:00', 15), '12:45:00');
  });
});
