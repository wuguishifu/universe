// Splits a symbol's daily bars into runs separated by gaps, to spot reused tickers.
// usage: ... research/tools/check-segments.ts SYM [SYM...]
import { AlpacaClient } from '../../src/download/alpaca-client';

const client = AlpacaClient.fromEnv();
for (const symbol of process.argv.slice(2)) {
  const bars = await client.dailyBars(symbol, '2016-01-01T00:00:00Z', '2026-11-14T00:00:00Z');
  console.log(`\n${symbol}: ${bars.length} bars`);
  let start = 0;
  for (let i = 1; i <= bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    const gapDays = cur && prev ? (Date.parse(cur.t) - Date.parse(prev.t)) / 86_400_000 : Infinity;
    const jump = cur && prev ? cur.o / prev.c : 1;
    if (gapDays > 7 || jump > 3 || jump < 1 / 3) {
      const a = bars[start];
      if (a && prev) {
        console.log(`  ${a.t.slice(0, 10)} → ${prev.t.slice(0, 10)}  ${String(i - start).padStart(4)} bars  close ${a.c} → ${prev.c}, volume ~${Math.round(prev.v)}`);
      }
      if (cur) console.log(`    -- gap ${gapDays.toFixed(0)} days, open/prev close ${jump.toFixed(2)}`);
      start = i;
    }
  }
}
