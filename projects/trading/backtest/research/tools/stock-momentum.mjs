// Idea 6: tests late-momentum direction calls on stock bars, with no options and no costs.
// usage: node research/tools/stock-momentum.mjs <data dir> [from] [to]
import { existsSync, readFileSync } from 'node:fs';

const [dataDir = 'data', from = '2016-01-04', to = '2023-12-29'] =
  process.argv.slice(2);
const TICKERS = ['SPY', 'QQQ', 'IWM'];

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
/** Milliseconds of New York midnight for a date (DST never changes during a trading day). */
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};

const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8'));

/** Regular-session 1-minute bars as { m: minute of day, o, c }, sorted, or null if no file. */
const sessionCache = new Map();
function session(ticker, day) {
  const key = `${ticker} ${day.date}`;
  if (sessionCache.has(key)) return sessionCache.get(key);
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  let bars = null;
  if (existsSync(path)) {
    const midnight = nyMidnight(day.date);
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    bars = JSON.parse(readFileSync(path, 'utf8'))
      .map((b) => ({
        m: (Date.parse(b.t) - midnight) / 60_000,
        o: b.o,
        c: b.c,
      }))
      .filter((b) => b.m >= open && b.m < close)
      .sort((a, b) => a.m - b.m);
  }
  sessionCache.set(key, bars);
  return bars;
}

/** Close of the last bar starting before `minute`, if it started within `maxStale` minutes. */
function priceAt(bars, minute, maxStale = 10) {
  let found;
  for (const b of bars) {
    if (b.m >= minute) break;
    found = b;
  }
  return found && minute - found.m <= maxStale ? found.c : undefined;
}

/** Signed returns for one setting: [{ ticker, date, year, dir, r }]. */
function events(
  { measure, before, minMove, reference = 'open', exitBefore = 2 },
  range,
) {
  const out = [];
  let skipped = 0;
  calendar.forEach((day, i) => {
    if (day.date < range.from || day.date > range.to) return;
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    for (const ticker of TICKERS) {
      const bars = session(ticker, day);
      if (!bars?.length || bars[0].m > open + 5) {
        skipped++;
        continue;
      }
      let ref = bars[0].o;
      if (reference === 'previousClose') {
        const prevDay = i > 0 ? calendar[i - 1] : undefined;
        const prev = prevDay && session(ticker, prevDay);
        if (!prev?.length) {
          skipped++;
          continue;
        }
        ref = prev.at(-1).c;
      }
      const measured = priceAt(bars, open + measure);
      const entry = priceAt(bars, close - before);
      const exit = priceAt(bars, close - exitBefore);
      if (measured === undefined || entry === undefined || exit === undefined) {
        skipped++;
        continue;
      }
      const move = measured / ref - 1;
      if (Math.abs(move) < minMove || move === 0) continue;
      const dir = Math.sign(move);
      out.push({
        ticker,
        date: day.date,
        year: day.date.slice(0, 4),
        dir,
        r: dir * (exit / entry - 1),
      });
    }
  });
  return { events: out, skipped };
}

const tStat = (xs) => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
};
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const bps = (x) => (x * 10_000).toFixed(1).padStart(6);
const t2 = (x) => x.toFixed(2).padStart(6);

/** Averages same-date returns so correlated tickers count as one observation per date. */
function byDate(evs) {
  const dates = new Map();
  for (const e of evs) dates.set(e.date, [...(dates.get(e.date) ?? []), e.r]);
  return [...dates.values()].map(mean);
}

function summarize(evs) {
  const daily = byDate(evs);
  return {
    n: evs.length,
    days: daily.length,
    mean: mean(evs.map((e) => e.r)),
    hit: evs.filter((e) => e.r > 0).length / (evs.length || 1),
    t: tStat(daily),
  };
}

function report(label, setting, range) {
  const { events: evs, skipped } = events(setting, range);
  const all = summarize(evs);
  console.log(`\n## ${label}  (${range.from} → ${range.to})`);
  console.log(
    `${all.n} ticker-days on ${all.days} dates, ${skipped} ticker-days skipped for missing bars`,
  );
  console.log(
    `combined: mean ${bps(all.mean)} bps, hit ${(all.hit * 100).toFixed(1)}%, day-clustered t ${t2(all.t)}`,
  );
  console.log('ticker   n   mean bps   hit%     t');
  for (const ticker of TICKERS) {
    const evT = evs.filter((e) => e.ticker === ticker);
    const s = summarize(evT);
    console.log(
      `${ticker.padEnd(6)}${String(s.n).padStart(5)}  ${bps(s.mean)}   ${(s.hit * 100).toFixed(1).padStart(5)} ${t2(tStat(evT.map((e) => e.r)))}`,
    );
  }
  console.log('year     n   mean bps   hit%     t');
  for (const year of [...new Set(evs.map((e) => e.year))].sort()) {
    const s = summarize(evs.filter((e) => e.year === year));
    console.log(
      `${year.padEnd(6)}${String(s.n).padStart(5)}  ${bps(s.mean)}   ${(s.hit * 100).toFixed(1).padStart(5)} ${t2(s.t)}`,
    );
  }
  for (const [name, dir] of [
    ['up days (calls)', 1],
    ['down days (puts)', -1],
  ]) {
    const s = summarize(evs.filter((e) => e.dir === dir));
    console.log(
      `${name.padEnd(18)} n ${String(s.n).padStart(5)}  mean ${bps(s.mean)} bps  hit ${(s.hit * 100).toFixed(1)}%  t ${t2(s.t)}`,
    );
  }
  return { all, evs };
}

const fresh = { from, to };
const C1 = { measure: 30, before: 60, minMove: 0.005 };

console.log('# Primary test: C1 rule');
const { all, evs } = report(
  'C1: open → 10:00 ≥ 0.5%, 15:00 → 15:58',
  C1,
  fresh,
);
const tickersPositive = TICKERS.filter(
  (t) => mean(evs.filter((e) => e.ticker === t).map((e) => e.r)) > 0,
).length;
const years = [...new Set(evs.map((e) => e.year))];
const yearsPositive = years.filter(
  (y) => mean(evs.filter((e) => e.year === y).map((e) => e.r)) > 0,
).length;
const pass =
  all.mean > 0 && all.t >= 2 && tickersPositive >= 2 && yearsPositive >= 5;
console.log(
  `\nPass rule: t ${all.t.toFixed(2)} (≥ 2), ${tickersPositive}/3 tickers positive (≥ 2), ${yearsPositive}/${years.length} years positive (≥ 5) → ${pass ? 'PASS' : 'FAIL'}`,
);

console.log('\n# Information only');
report('C1 on the options period', C1, {
  from: '2024-02-01',
  to: '2026-11-13',
});
report(
  "Paper's version: previous close → 10:00, any size, last 30 min",
  { measure: 30, before: 30, minMove: 0, reference: 'previousClose' },
  fresh,
);
report(
  'Previous close → 10:00 ≥ 0.5%, 15:00 → 15:58',
  { ...C1, reference: 'previousClose' },
  fresh,
);

console.log(
  `\n## Grid (${from} → ${to}): combined mean bps / day-clustered t / ticker-days`,
);
const minMoves = [0.0025, 0.005, 0.01];
console.log(
  `entry    measure ${minMoves.map((m) => `${(m * 100).toFixed(2)}%`.padStart(22)).join('')}`,
);
for (const before of [120, 90, 60, 30]) {
  for (const measure of [15, 30, 60]) {
    const cells = minMoves.map((minMove) => {
      const s = summarize(events({ measure, before, minMove }, fresh).events);
      return `${bps(s.mean)} ${t2(s.t)} ${String(s.n).padStart(5)}`.padStart(
        22,
      );
    });
    console.log(
      `close-${String(before).padEnd(4)} ${String(measure).padStart(3)}m   ${cells.join('')}`,
    );
  }
}
