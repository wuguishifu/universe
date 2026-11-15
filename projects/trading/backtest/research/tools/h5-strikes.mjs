// h5 strike-availability check: are the strikes a weekly credit spread needs in the entry-day file,
// and do they trade within 5 minutes of entry? Reads spot and option bar timestamps only; no P&L.
// usage: node h5-strikes.mjs [from] [to]
import {
  tradingWeeks, stockDay, spotAt, optionDay, expirations, strikes, occ, firstPrint, msAt,
  daysBetween, hhmm,
} from './h5-common.mjs';

const [from = '2024-02-01', to = '2026-04-30'] = process.argv.slice(2);
const weeks = tradingWeeks(from, to);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');

for (const entryKind of ['friday', 'monday']) {
  console.log(`\n=== entry: ${entryKind === 'friday' ? 'last trading day of week' : 'first trading day of week'}, 30 min before close ===`);
  for (const ticker of ['SPY', 'QQQ', 'IWM']) {
    const counts = {};
    const bump = (k, ok) => {
      counts[k] ??= [0, 0];
      counts[k][1]++;
      if (ok) counts[k][0]++;
    };
    const lowEdge = [];
    const highEdge = [];
    let n = 0;
    let noExp = 0;
    const dte = {};
    for (const { days } of weeks) {
      const day = entryKind === 'friday' ? days.at(-1) : days[0];
      const last = days.at(-1);
      if (entryKind === 'monday' && days.length < 2) continue;
      const bars = stockDay(ticker, day);
      const chain = optionDay(ticker, day.date);
      if (!bars?.length || !chain?.size) continue;
      const m = hhmm(day.close) - 30;
      const S = spotAt(bars, m);
      const t = msAt(bars, m);
      const exps = expirations(chain, ticker).filter((e) => {
        const d = daysBetween(day.date, e);
        if (entryKind === 'friday') return d >= 1 && d <= 7;
        return e > day.date && e <= last.date;
      });
      n++;
      if (!exps.length) {
        noExp++;
        continue;
      }
      const expiry = exps.at(-1);
      const d = daysBetween(day.date, expiry);
      dte[d] = (dte[d] ?? 0) + 1;
      const puts = strikes(chain, ticker, expiry, 'P');
      lowEdge.push((puts[0] / S - 1) * 100);
      highEdge.push((puts.at(-1) / S - 1) * 100);
      for (const k of [0.005, 0.01, 0.02]) {
        for (const [type, sign] of [['P', -1], ['C', 1]]) {
          const K = Math.round(S * (1 + sign * k));
          const shortOk = !!firstPrint(chain.get(occ(ticker, expiry, type, K)), t);
          bump(`${type} short ${k * 100}%`, shortOk);
          for (const w of [0.005, 0.01, 0.02]) {
            const W = Math.max(1, Math.round(S * w));
            const L = K + sign * W;
            const inFile = chain.has(occ(ticker, expiry, type, L));
            const traded = !!firstPrint(chain.get(occ(ticker, expiry, type, L)), t);
            bump(`${type} short ${k * 100}% wing ${w * 100}%: in file`, inFile);
            bump(`${type} short ${k * 100}% wing ${w * 100}%: both legs trade`, traded && shortOk);
          }
        }
      }
    }
    const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]?.toFixed(2);
    console.log(`\n${ticker}: entry days ${n}, no usable expiry ${noExp}, days-to-expiry ${JSON.stringify(dte)}`);
    console.log(`  lowest put strike in file, % from spot: p10 ${q(lowEdge, 0.1)} median ${q(lowEdge, 0.5)} p90 ${q(lowEdge, 0.9)}`);
    console.log(`  highest strike in file, % from spot:   p10 ${q(highEdge, 0.1)} median ${q(highEdge, 0.5)} p90 ${q(highEdge, 0.9)}`);
    for (const [k, [ok, tot]] of Object.entries(counts)) console.log(`  ${k.padEnd(44)} ${String(ok).padStart(4)}/${tot} ${pct(ok, tot)}`);
  }
}
