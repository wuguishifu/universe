// Part 4: turn-of-the-month and pre-FOMC drift, as pre-registered in LOG.md.
// usage: node research/tools/calendar-effects.mjs <data dir>
import { existsSync, readFileSync } from 'node:fs';

const dataDir = process.argv[2] ?? 'data';
const FROM = '2016-02-01';
const FULL_YEARS = [
  '2016',
  '2017',
  '2018',
  '2019',
  '2020',
  '2021',
  '2022',
  '2023',
  '2024',
  '2025',
];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const variance = (xs) => {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
};
/** Difference in means and Welch's t. */
const welch = (a, b) => {
  const diff = mean(a) - mean(b);
  return {
    diff,
    t: diff / Math.sqrt(variance(a) / a.length + variance(b) / b.length),
    n: a.length,
  };
};
const bp = (x) => `${(x * 10_000).toFixed(1)} bp`;
const t2 = (x) => x.toFixed(2);

// --- 4A: turn of the month ---------------------------------------------------------------------
const daily = (t) =>
  JSON.parse(readFileSync(`${dataDir}/daily/${t}.json`, 'utf8')).map((b) => ({
    date: b.t.slice(0, 10),
    c: b.c,
  }));
const bil = daily('BIL');
const dates = bil.map((b) => b.date);
const bilReturn = bil.map((b, i) => (i === 0 ? 0 : b.c / bil[i - 1].c - 1));

/** Each date's position relative to the turn of the month: -5..-1 before it, +1..+3 after. */
const offset = new Array(dates.length).fill(0);
for (let i = 0; i + 1 < dates.length; i++) {
  if (dates[i].slice(0, 7) === dates[i + 1].slice(0, 7)) continue;
  for (let k = 0; k < 5 && i - k >= 0; k++) offset[i - k] = -1 - k;
  for (let k = 1; k <= 3 && i + k < dates.length; k++) offset[i + k] = k;
}
const inWindow = (o) => o === -1 || (o >= 1 && o <= 3);
const preWindow = (o) => o <= -2 && o >= -5;

/** Daily excess returns over BIL from FROM on, aligned with `dates`. */
function excessReturns(ticker) {
  const bars = new Map(daily(ticker).map((b) => [b.date, b.c]));
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    const now = bars.get(dates[i]);
    const before = bars.get(dates[i - 1]);
    if (dates[i] < FROM || now === undefined || before === undefined) continue;
    out.push({
      i,
      date: dates[i],
      r: now / before - 1,
      x: now / before - 1 - bilReturn[i],
      o: offset[i],
    });
  }
  return out;
}

console.log(
  '# 4A. Turn of the month: days -1..+3 vs all other days (daily excess return over BIL)\n',
);
const tomResults = {};
for (const ticker of ['SPY', 'QQQ', 'IWM', 'EFA', 'IEF', 'TLT']) {
  const rs = excessReturns(ticker);
  const win = rs.filter((r) => inWindow(r.o)).map((r) => r.x);
  const other = rs.filter((r) => !inWindow(r.o)).map((r) => r.x);
  const pre = rs.filter((r) => preWindow(r.o)).map((r) => r.x);
  const otherNotPre = rs
    .filter((r) => !inWindow(r.o) && !preWindow(r.o))
    .map((r) => r.x);
  const w = welch(win, other);
  const p = welch(pre, otherNotPre);
  tomResults[ticker] = { rs, w };
  const info = ['IEF', 'TLT'].includes(ticker) ? ' (information only)' : '';
  console.log(
    `${ticker.padEnd(4)} window ${bp(mean(win)).padStart(8)}/day (${win.length} days)  other ${bp(mean(other)).padStart(7)}/day  diff ${bp(w.diff).padStart(8)}  t ${t2(w.t).padStart(5)}   | days -5..-2 vs rest ${bp(p.diff).padStart(8)} t ${t2(p.t).padStart(5)}${info}`,
  );
}

const spy = tomResults.SPY.rs;
console.log('\nSPY by year (window minus other, per day):');
const yearsPositive = FULL_YEARS.filter((y) => {
  const ys = spy.filter((r) => r.date.startsWith(y));
  const w = welch(
    ys.filter((r) => inWindow(r.o)).map((r) => r.x),
    ys.filter((r) => !inWindow(r.o)).map((r) => r.x),
  );
  process.stdout.write(`${y} ${bp(w.diff)}   `);
  return w.diff > 0;
}).length;
console.log();
const ys2026 = spy.filter((r) => r.date.startsWith('2026'));
console.log(
  `2026 (partial) ${bp(
    welch(
      ys2026.filter((r) => inWindow(r.o)).map((r) => r.x),
      ys2026.filter((r) => !inWindow(r.o)).map((r) => r.x),
    ).diff,
  )}`,
);

console.log('\nSPY by offset (mean excess per day):');
for (const o of [-5, -4, -3, -2, -1, 1, 2, 3]) {
  const xs = spy.filter((r) => r.o === o).map((r) => r.x);
  process.stdout.write(`${o > 0 ? '+' : ''}${o}: ${bp(mean(xs))}  `);
}
console.log(
  `  rest: ${bp(mean(spy.filter((r) => r.o === 0).map((r) => r.x)))}`,
);

/** Annualized Sharpe of daily excess returns, CAGR and max drawdown of total returns. */
function performance(totals, bils) {
  const ex = totals.map((r, i) => r - bils[i]);
  const sharpe = (mean(ex) / Math.sqrt(variance(ex))) * Math.sqrt(252);
  let value = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of totals) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    maxDd = Math.max(maxDd, 1 - value / peak);
  }
  return { sharpe, cagr: value ** (252 / totals.length) - 1, maxDd };
}

console.log(
  '\nStrategy: SPY from the close of day -2 to the close of day +3, BIL otherwise.',
);
const bils = spy.map((r) => bilReturn[r.i]);
const hold = performance(
  spy.map((r) => r.r),
  bils,
);
console.log(
  `SPY buy & hold            Sharpe ${t2(hold.sharpe)}  CAGR ${(hold.cagr * 100).toFixed(1)}%  max DD ${(hold.maxDd * 100).toFixed(1)}%`,
);
const tomPass = {};
for (const costBps of [2, 5]) {
  const totals = spy.map((r) => {
    if (!inWindow(r.o)) return bilReturn[r.i];
    let x = r.r;
    // Entering (sell BIL, buy SPY) on the day before the window, exiting on +3: two sides each.
    if (r.o === -1) x -= (2 * costBps) / 10_000;
    if (r.o === 3) x -= (2 * costBps) / 10_000;
    return x;
  });
  const p = performance(totals, bils);
  tomPass[costBps] = p.sharpe;
  console.log(
    `Turn of month, ${costBps} bp/side   Sharpe ${t2(p.sharpe)}  CAGR ${(p.cagr * 100).toFixed(1)}%  max DD ${(p.maxDd * 100).toFixed(1)}%  (in SPY ${((spy.filter((r) => inWindow(r.o)).length / spy.length) * 100).toFixed(0)}% of days)`,
  );
}

const positive = ['SPY', 'QQQ', 'IWM', 'EFA'].filter(
  (t) => tomResults[t].w.diff > 0,
).length;
const exists =
  tomResults.SPY.w.diff > 0 &&
  tomResults.SPY.w.t >= 2 &&
  positive >= 3 &&
  yearsPositive >= 6;
console.log(
  `\nPass rule 4A: SPY t ${t2(tomResults.SPY.w.t)} (≥ 2), ${positive}/4 tickers positive (≥ 3), ${yearsPositive}/10 years positive (≥ 6) → effect ${exists ? 'EXISTS' : 'NOT SHOWN'}; worth trading: Sharpe at 5 bp ${t2(tomPass[5])} vs buy & hold ${t2(hold.sharpe)} → ${exists && tomPass[5] > hold.sharpe ? 'YES' : 'NO'}`,
);

// --- 4B: pre-FOMC drift ------------------------------------------------------------------------
const fomc = new Set(
  JSON.parse(readFileSync(`${dataDir}/fomc/dates.json`, 'utf8')),
);
const calendar = JSON.parse(
  readFileSync(`${dataDir}/calendar.json`, 'utf8'),
).filter((d) => d.date >= '2016-01-04' && d.date <= '2026-11-13');
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyMidnight = (date) => {
  const noon = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noon).split(':').map(Number);
  return noon - (h * 60 + m) * 60_000;
};
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** Price at 14:00 (close of the last bar before it, within 10 minutes) and the session close. */
function levels(ticker, day) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return undefined;
  const midnight = nyMidnight(day.date);
  const close = hhmm(day.close);
  const bars = JSON.parse(readFileSync(path, 'utf8'))
    .map((b) => ({ m: (Date.parse(b.t) - midnight) / 60_000, c: b.c }))
    .filter((b) => b.m >= hhmm(day.open) && b.m < close)
    .sort((a, b) => a.m - b.m);
  const before2 = bars.filter((b) => b.m < 840).at(-1);
  return {
    at2:
      before2 && 840 - before2.m <= 10 && close > 840 ? before2.c : undefined,
    close: bars.at(-1)?.c,
  };
}

console.log(
  '\n# 4B. Pre-FOMC drift: 14:00 the day before → 14:00 on announcement day\n',
);
const fomcResults = {};
for (const ticker of ['SPY', 'QQQ', 'IWM']) {
  const lv = calendar.map((d) => levels(ticker, d));
  const pre = [];
  const other = [];
  const reaction = [];
  calendar.forEach((d, i) => {
    if (i === 0) return;
    const a = lv[i - 1]?.at2;
    const b = lv[i]?.at2;
    if (a === undefined || b === undefined) return;
    const r = b / a - 1;
    if (fomc.has(d.date)) {
      pre.push({ date: d.date, r });
      const c = lv[i]?.close;
      if (c !== undefined) reaction.push(c / b - 1);
    } else other.push(r);
  });
  const w = welch(
    pre.map((p) => p.r),
    other,
  );
  fomcResults[ticker] = { pre, other, w };
  console.log(
    `${ticker.padEnd(4)} pre-FOMC ${bp(mean(pre.map((p) => p.r))).padStart(8)} (${pre.length} events)  other ${bp(mean(other)).padStart(7)} (${other.length})  diff ${bp(w.diff).padStart(8)}  t ${t2(w.t).padStart(5)}  hit ${((pre.filter((p) => p.r > 0).length / pre.length) * 100).toFixed(0)}%  | 14:00→close on the day ${bp(mean(reaction))}`,
  );
}
const missing = [...fomc].filter(
  (d) =>
    d >= '2016-01-04' &&
    d <= '2026-11-13' &&
    !fomcResults.SPY.pre.some((p) => p.date === d),
);
console.log(
  `announcement dates without a 14:00 → 14:00 pair: ${missing.join(', ') || 'none'}`,
);

console.log('\nSPY by year (pre-FOMC mean minus other mean):');
const otherMean = mean(fomcResults.SPY.other);
const fomcYears = FULL_YEARS.filter((y) => {
  const xs = fomcResults.SPY.pre
    .filter((p) => p.date.startsWith(y))
    .map((p) => p.r);
  process.stdout.write(`${y} ${bp(mean(xs) - otherMean)} (${xs.length})  `);
  return mean(xs) - otherMean > 0;
}).length;
console.log();
const fomcPass =
  fomcResults.SPY.w.diff > 0 &&
  fomcResults.SPY.w.t >= 2 &&
  fomcResults.QQQ.w.diff > 0 &&
  fomcResults.IWM.w.diff > 0 &&
  fomcYears >= 6;
console.log(
  `\nPass rule 4B: SPY t ${t2(fomcResults.SPY.w.t)} (≥ 2), QQQ ${fomcResults.QQQ.w.diff > 0 ? '+' : '−'}, IWM ${fomcResults.IWM.w.diff > 0 ? '+' : '−'}, ${fomcYears}/10 years positive (≥ 6) → ${fomcPass ? 'PASS' : 'FAIL'}`,
);
