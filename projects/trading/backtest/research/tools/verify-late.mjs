// Recomputes open-referenced late-momentum signals from raw bars and compares with a run.
// usage: node verify-late.mjs <data dir> <run dir> <from> <to> <measureMin> <entryBeforeClose> <minMove>
import { readFileSync } from 'node:fs';

const [dataDir, runDir, from, to, mArg, eArg, minArg] = process.argv.slice(2);
const measure = Number(mArg);
const before = Number(eArg);
const minMove = Number(minArg);
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
const calendar = JSON.parse(
  readFileSync(`${dataDir}/calendar.json`, 'utf8'),
).filter((d) => d.date >= from && d.date <= to);

const mine = [];
for (const ticker of ['SPY', 'QQQ', 'IWM']) {
  for (const day of calendar) {
    const raw = JSON.parse(
      readFileSync(`${dataDir}/stocks/${ticker}/${day.date}.json`, 'utf8'),
    );
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    const bars = raw
      .map((b) => ({ ...b, m: nyMinute(Date.parse(b.t)), ms: Date.parse(b.t) }))
      .filter((b) => b.m >= open && b.m < close)
      .sort((a, b) => a.ms - b.ms);
    if (!bars.length) continue;
    const sessionOpen = bars[0].o;
    // Close of the last 1-minute bar before open + measure (the 5-minute bar ending then).
    const atMeasure = bars.filter((b) => b.m < open + measure).at(-1);
    const move = atMeasure.c / sessionOpen - 1;
    if (Math.abs(move) < minMove || move === 0) continue;
    // Signal time: end of the 5-minute bar that closes at close - before.
    const signalMinute = close - before;
    const ms = bars[0].ms + (signalMinute - bars[0].m) * 60000;
    mine.push(`${ticker} ${move > 0 ? 'bullish' : 'bearish'} ${ms}`);
  }
}
const engine = readFileSync(`${runDir}/events.jsonl`, 'utf8')
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
