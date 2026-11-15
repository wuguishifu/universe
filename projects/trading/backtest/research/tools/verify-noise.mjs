// Recomputes noise-band breakout signals from raw bars, independently of the engine, and
// compares them with a run's events.jsonl.
// usage: node verify-noise.mjs <data dir> <events.jsonl> <from> <to> <tf> <mult> <lookback>
import { readFileSync } from 'node:fs';

const [dataDir, eventsPath, from, to, tfArg, multArg, lbArg] =
  process.argv.slice(2);
const tf = Number(tfArg);
const mult = Number(multArg);
const lookback = Number(lbArg);
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8'));
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyMinute = (ms) => {
  const [h, m] = fmt.format(ms).split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

const days = calendar.filter((d) => d.date <= to);
const firstIdx = days.findIndex((d) => d.date >= from);
const span = days.slice(Math.max(0, firstIdx - 20));

const mine = [];
for (const ticker of ['SPY', 'QQQ', 'IWM']) {
  const history = new Map(); // offset -> moves
  let prevClose;
  for (const day of span) {
    let raw;
    try {
      raw = JSON.parse(
        readFileSync(`${dataDir}/stocks/${ticker}/${day.date}.json`, 'utf8'),
      );
    } catch {
      continue;
    }
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    const bars = raw
      .map((b) => ({ ...b, ms: Date.parse(b.t) }))
      .filter((b) => {
        const m = nyMinute(b.ms);
        return m >= open && m < close;
      })
      .sort((a, b) => a.ms - b.ms);
    if (!bars.length) continue;
    // Aggregate into tf-minute bars aligned to the open.
    const groups = new Map();
    for (const b of bars) {
      const k = Math.floor((nyMinute(b.ms) - open) / tf);
      const g = groups.get(k);
      if (!g)
        groups.set(k, {
          k,
          start: b.ms - ((nyMinute(b.ms) - open) % tf) * 60000,
          o: b.o,
          c: b.c,
        });
      else g.c = b.c;
    }
    const sessionOpen = bars[0].o;
    const firstStart = Math.floor((nyMinute(bars[0].ms) - open) / tf) * tf;
    let side = 0;
    const today = new Map();
    for (const g of [...groups.values()].sort((a, b) => a.k - b.k)) {
      const offset = g.k * tf - firstStart;
      const past = history.get(offset);
      let upper, lower;
      if (past && past.length >= lookback) {
        const sigma = past.reduce((a, b) => a + b, 0) / past.length;
        const ref = prevClose ?? sessionOpen;
        upper = Math.max(sessionOpen, ref) * (1 + mult * sigma);
        lower = Math.min(sessionOpen, ref) * (1 - mult * sigma);
      }
      today.set(offset, Math.abs(g.c / sessionOpen - 1));
      if (upper === undefined) continue;
      const s = g.c > upper ? 1 : g.c < lower ? -1 : 0;
      const prev = side;
      side = s;
      if (s !== 0 && s !== prev && day.date >= from) {
        mine.push(
          `${ticker} ${s === 1 ? 'bullish' : 'bearish'} ${g.start + tf * 60000}`,
        );
      }
    }
    for (const [offset, move] of today) {
      const past = history.get(offset) ?? [];
      past.push(move);
      if (past.length > lookback) past.shift();
      history.set(offset, past);
    }
    prevClose = bars.at(-1).c;
  }
}

const engine = readFileSync(eventsPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((e) => e.type === 'signal')
  .map((e) => `${e.ticker} ${e.direction} ${e.time}`);
const a = new Set(mine);
const b = new Set(engine);
console.log(`independent ${a.size}, engine ${b.size}`);
console.log('only independent:', [...a].filter((x) => !b.has(x)).slice(0, 10));
console.log('only engine:', [...b].filter((x) => !a.has(x)).slice(0, 10));
