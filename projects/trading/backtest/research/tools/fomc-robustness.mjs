// Information-only checks on the part 4B pre-FOMC result. Not part of the pass rule.
// usage: node research/tools/fomc-robustness.mjs <data dir>
import { existsSync, readFileSync } from 'node:fs';

const dataDir = process.argv[2] ?? 'data';
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
const priceAt = (ticker, day, minute) => {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path) || hhmm(day.close) <= minute) return undefined;
  const midnight = nyMidnight(day.date);
  const bar = JSON.parse(readFileSync(path, 'utf8'))
    .map((b) => ({ m: (Date.parse(b.t) - midnight) / 60_000, c: b.c }))
    .filter((b) => b.m >= hhmm(day.open) && b.m < minute)
    .sort((a, b) => a.m - b.m)
    .at(-1);
  return bar && minute - bar.m <= 10 ? bar.c : undefined;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs) =>
  Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const welchT = (a, b) =>
  (mean(a) - mean(b)) /
  Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length);
const bp = (x) => `${(x * 1e4).toFixed(1)}bp`;
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

const ticker = process.argv[3] ?? 'SPY';
const p14 = calendar.map((d) => priceAt(ticker, d, 840));
const pairs = [];
calendar.forEach((d, i) => {
  if (i === 0 || p14[i] === undefined || p14[i - 1] === undefined) return;
  pairs.push({
    date: d.date,
    r: p14[i] / p14[i - 1] - 1,
    fomc: fomc.has(d.date),
    wed: weekday(d.date) === 3 && weekday(calendar[i - 1].date) === 2,
  });
});
const pre = pairs.filter((p) => p.fomc);
const preR = pre.map((p) => p.r);
const other = pairs.filter((p) => !p.fomc).map((p) => p.r);
const tueWed = pairs.filter((p) => !p.fomc && p.wed).map((p) => p.r);
const sorted = [...preR].sort((a, b) => a - b);
console.log(
  `${ticker}: ${pre.length} events, mean ${bp(mean(preR))}, median ${bp(sorted[sorted.length >> 1])}, other median ${bp([...other].sort((a, b) => a - b)[other.length >> 1])}`,
);
console.log(
  `vs non-FOMC Tue 14:00 → Wed 14:00 only (${tueWed.length}): diff ${bp(mean(preR) - mean(tueWed))}, t ${welchT(preR, tueWed).toFixed(2)}`,
);
const no2022 = pre.filter((p) => !p.date.startsWith('2022')).map((p) => p.r);
console.log(
  `without 2022 (${no2022.length}): diff ${bp(mean(no2022) - mean(other))}, t ${welchT(no2022, other).toFixed(2)}`,
);
const noTop5 = sorted.slice(0, -5);
console.log(
  `without the 5 best events: diff ${bp(mean(noTop5) - mean(other))}, t ${welchT(noTop5, other).toFixed(2)}`,
);
const trimmed = sorted.slice(5, -5);
console.log(`trimmed (drop 5 best and 5 worst): mean ${bp(mean(trimmed))}`);
const halves = [
  pre.filter((p) => p.date < '2021-07-01').map((p) => p.r),
  pre.filter((p) => p.date >= '2021-07-01').map((p) => p.r),
];
console.log(
  `first half (to 2021-06): ${bp(mean(halves[0]) - mean(other))} (${halves[0].length}), t ${welchT(halves[0], other).toFixed(2)}; second half: ${bp(mean(halves[1]) - mean(other))} (${halves[1].length}), t ${welchT(halves[1], other).toFixed(2)}`,
);
console.log(
  `best 5: ${pre
    .sort((a, b) => b.r - a.r)
    .slice(0, 5)
    .map((p) => `${p.date} ${bp(p.r)}`)
    .join(', ')}`,
);
