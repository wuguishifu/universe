// Checks adjusted daily bars against regular-session prices built from 1-minute bars.
// usage: node research/tools/check-daily.mjs <data dir>
import { existsSync, readFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'data';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ny = (ms) => {
  const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
};
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const calendar = new Map(JSON.parse(readFileSync(`${dir}/calendar.json`, 'utf8')).map((d) => [d.date, d]));

for (const ticker of ['SPY', 'QQQ', 'IWM']) {
  const daily = JSON.parse(readFileSync(`${dir}/daily/${ticker}.json`, 'utf8')).map((b) => ({ ...b, date: ny(Date.parse(b.t)).date }));
  let n = 0, intraOff = 0, worstIntra = 0, ccOff = 0, prev;
  const offDays = [];
  for (const d of daily) {
    const path = `${dir}/stocks/${ticker}/${d.date}.json`;
    const day = calendar.get(d.date);
    if (!existsSync(path) || !day) { prev = undefined; continue; }
    const bars = JSON.parse(readFileSync(path, 'utf8')).map((b) => ({ ...b, m: ny(Date.parse(b.t)).minute })).filter((b) => b.m >= hhmm(day.open) && b.m < hhmm(day.close));
    if (!bars.length) { prev = undefined; continue; }
    const open = bars[0].o, close = bars.at(-1).c;
    n++;
    const diff = Math.abs(d.c / d.o - close / open);
    worstIntra = Math.max(worstIntra, diff);
    if (diff > 0.001) { intraOff++; if (offDays.length < 5) offDays.push(`${d.date} ${(diff * 1e4).toFixed(0)}bp`); }
    if (prev) {
      const ccDiff = Math.abs(d.c / prev.daily - 1 - (close / prev.close - 1));
      if (ccDiff > 0.0005) ccOff++;
    }
    prev = { daily: d.c, close };
  }
  console.log(`${ticker}: ${n} days compared. Open→close return differs by >10bp on ${intraOff} (worst ${(worstIntra * 1e4).toFixed(1)}bp${offDays.length ? `: ${offDays.join(', ')}` : ''}). Close→close differs by >5bp on ${ccOff} days (dividends should explain ~4/yr).`);
}
