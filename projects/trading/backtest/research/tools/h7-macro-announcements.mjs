// H7: the macro-announcement premium (Savor & Wilson 2013), as pre-registered in research/hypotheses/h7.md.
// usage: node research/tools/h7-macro-announcements.mjs [data dir]
import { existsSync, readFileSync } from 'node:fs';

const dataDir = process.argv[2] ?? 'data';
const FROM = '2016-01-05';
const TO = '2026-11-13';
const FULL_YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- stats -----------------------------------------------------------------------------------------
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const variance = (xs) => {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
};
const sd = (xs) => Math.sqrt(variance(xs));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const welch = (a, b) => {
  const diff = mean(a) - mean(b);
  return { diff, t: diff / Math.sqrt(variance(a) / a.length + variance(b) / b.length) };
};
const bp = (x, d = 1) => `${(x * 10_000).toFixed(d)}`;
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);

// --- data ------------------------------------------------------------------------------------------
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8'));
const closeTime = new Map(calendar.map((d) => [d.date, d.close]));
const daily = (t) =>
  new Map(
    JSON.parse(readFileSync(`${dataDir}/daily/${t}.json`, 'utf8')).map((b) => [
      b.t.slice(0, 10),
      { o: b.o, c: b.c },
    ]),
  );
const bilBars = daily('BIL');
const allDates = [...bilBars.keys()].sort();
const tradingDays = allDates.filter((d) => d <= TO);
const idx = new Map(tradingDays.map((d, i) => [d, i]));
const sampleDays = tradingDays.filter((d) => d >= FROM);
const bilRet = new Map();
for (let i = 1; i < tradingDays.length; i++)
  bilRet.set(tradingDays[i], bilBars.get(tradingDays[i]).c / bilBars.get(tradingDays[i - 1]).c - 1);

// Check BIL's dates against the calendar (holidays): every BIL date must be a calendar trading day.
const calSet = new Set(calendar.map((d) => d.date));
const notInCal = tradingDays.filter((d) => !calSet.has(d));
const calMissing = calendar.map((d) => d.date).filter((d) => d >= FROM && d <= TO && !idx.has(d));

const bls = JSON.parse(readFileSync(`${dataDir}/bls/dates.json`, 'utf8'));
const fomcAll = JSON.parse(readFileSync(`${dataDir}/fomc/dates.json`, 'utf8'));

/** Move a release date to the first trading day on or after it (Good Friday rule); or drop it. */
function mapEvents(list, rule) {
  const out = [];
  const moved = [];
  for (const d of list) {
    if (d < FROM || d > TO) continue;
    if (idx.has(d)) {
      out.push(d);
      continue;
    }
    if (rule === 'drop') {
      moved.push(`${d} dropped`);
      continue;
    }
    const next = tradingDays.find((x) => x > d);
    if (next) {
      out.push(next);
      moved.push(`${d} -> ${next}`);
    }
  }
  return { dates: [...new Set(out)].sort(), moved };
}

const cpi = mapEvents(bls.cpi, 'next');
const jobs = mapEvents(bls.empsit, 'next');
const cpiDrop = mapEvents(bls.cpi, 'drop');
const jobsDrop = mapEvents(bls.empsit, 'drop');
const fomc = fomcAll.filter((d) => d >= FROM && d <= TO);
const fomcNotTrading = fomc.filter((d) => !idx.has(d));

const E = new Set([...cpi.dates, ...jobs.dates]);
const EDrop = new Set([...cpiDrop.dates, ...jobsDrop.dates]);
const CPI = new Set(cpi.dates);
const JOBS = new Set(jobs.dates);
const FOMC = new Set(fomc);
const ALL_ANN = new Set([...E, ...FOMC]);
const isN = (d) => !E.has(d) && !FOMC.has(d) && !CPI.has(d) && !JOBS.has(d);
// N under the "drop" rule: the Mondays after Good Friday releases go back into N.
const isNDrop = (d) => !EDrop.has(d) && !FOMC.has(d);

const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** Per-day records for a ticker: close-to-close excess, overnight and intraday raw returns. */
const recCache = new Map();
function records(ticker) {
  if (recCache.has(ticker)) return recCache.get(ticker);
  const bars = daily(ticker);
  const out = [];
  for (const d of sampleDays) {
    const i = idx.get(d);
    const now = bars.get(d);
    const prev = bars.get(tradingDays[i - 1]);
    if (!now || !prev) continue;
    const r = now.c / prev.c - 1;
    out.push({
      d,
      y: d.slice(0, 4),
      w: weekday(d),
      r,
      x: r - bilRet.get(d),
      on: now.o / prev.c - 1,
      id: now.c / now.o - 1,
    });
  }
  recCache.set(ticker, out);
  return out;
}

/** Weekday-stratified difference, weighted by the event counts per weekday. */
function stratified(ev, non, key = 'x') {
  const n = ev.length;
  let D = 0;
  let se2 = 0;
  const parts = [];
  for (let w = 1; w <= 5; w++) {
    const a = ev.filter((r) => r.w === w).map((r) => r[key]);
    const b = non.filter((r) => r.w === w).map((r) => r[key]);
    if (!a.length) continue;
    const wt = a.length / n;
    const d = mean(a) - mean(b);
    D += wt * d;
    // An event weekday with a single event contributes variance from the pooled weekday sample.
    const va = a.length > 1 ? variance(a) : variance(b);
    se2 += wt ** 2 * (va / a.length + variance(b) / b.length);
    parts.push({ w, nE: a.length, nN: b.length, mE: mean(a), mN: mean(b), d });
  }
  return { D, t: D / Math.sqrt(se2), parts };
}

function compare(ticker, evPred, nonPred, key = 'x') {
  const rs = records(ticker);
  const ev = rs.filter((r) => evPred(r.d));
  const non = rs.filter((r) => nonPred(r.d));
  const a = ev.map((r) => r[key]);
  const b = non.map((r) => r[key]);
  return { ev, non, a, b, ...welch(a, b) };
}

const lines = [];
const log = (s = '') => {
  lines.push(s);
  console.log(s);
};

// --- data report -----------------------------------------------------------------------------------
log('# H7: macro-announcement premium. Close-to-close excess over BIL, adjusted daily bars.');
log(`Sample ${sampleDays[0]} -> ${sampleDays.at(-1)}: ${sampleDays.length} trading days.`);
log(
  `BIL dates not in calendar.json: ${notInCal.length ? notInCal.join(', ') : 'none'}; calendar days missing from BIL: ${calMissing.length ? calMissing.join(', ') : 'none'}`,
);
log(`CPI events ${cpi.dates.length} (moved: ${cpi.moved.join('; ') || 'none'})`);
log(`Jobs events ${jobs.dates.length} (moved: ${jobs.moved.join('; ') || 'none'})`);
log(`E = CPI ∪ jobs: ${E.size} event days. FOMC in range: ${fomc.length} (not trading days: ${fomcNotTrading.length})`);
log(`CPI days that are also FOMC days: ${cpi.dates.filter((d) => FOMC.has(d)).join(', ')}`);
const nDays = sampleDays.filter(isN).length;
log(`N (non-announcement days): ${nDays}. Days held by the strategy: ${E.size} (${((E.size / sampleDays.length) * 100).toFixed(1)}% of days)`);
const wdE = {};
for (const d of E) wdE[WEEKDAYS[weekday(d)]] = (wdE[WEEKDAYS[weekday(d)]] ?? 0) + 1;
log(`E by weekday: ${JSON.stringify(wdE)}`);
for (const t of ['SPY', 'QQQ', 'IWM', 'IEF', 'TLT']) {
  const rs = records(t);
  const missing = sampleDays.length - rs.length;
  if (missing) log(`WARNING ${t}: ${missing} sample days without a bar`);
}

// --- primary ---------------------------------------------------------------------------------------
log('\n## Primary: E (CPI + jobs) vs N, daily excess return over BIL, bp');
log(
  `${padr('Ticker', 7)}${pad('nE', 5)}${pad('E mean', 8)}${pad('E med', 7)}${pad('E up%', 6)}${pad('E sd', 7)}${pad('nN', 6)}${pad('N mean', 8)}${pad('N med', 7)}${pad('N up%', 6)}${pad('N sd', 7)}${pad('diff', 7)}${pad('t', 7)}${pad('sdE/sdN', 9)}${pad('m/v E', 8)}${pad('m/v N', 8)}`,
);
const prim = {};
for (const t of ['SPY', 'QQQ', 'IWM', 'IEF', 'TLT']) {
  const c = compare(t, (d) => E.has(d), isN);
  prim[t] = c;
  const up = (xs) => ((xs.filter((x) => x > 0).length / xs.length) * 100).toFixed(0);
  log(
    `${padr(t, 7)}${pad(c.a.length, 5)}${pad(bp(mean(c.a)), 8)}${pad(bp(median(c.a)), 7)}${pad(up(c.a), 6)}${pad(bp(sd(c.a), 0), 7)}${pad(c.b.length, 6)}${pad(bp(mean(c.b)), 8)}${pad(bp(median(c.b)), 7)}${pad(up(c.b), 6)}${pad(bp(sd(c.b), 0), 7)}${pad(bp(c.diff), 7)}${pad(f2(c.t), 7)}${pad(f2(sd(c.a) / sd(c.b)), 9)}${pad(f2(mean(c.a) / variance(c.a)), 8)}${pad(f2(mean(c.b) / variance(c.b)), 8)}`,
  );
}
log('(m/v = mean / variance of daily excess returns, in units of 1/return; the paper\'s reward-to-risk per day.)');
log('IEF and TLT rows are information only (#5, #6).');

// Same-weekday check.
log('\n## Same-weekday check (required): weekday-stratified difference, weighted by event counts');
const strat = {};
for (const t of ['SPY', 'QQQ', 'IWM']) {
  const c = prim[t];
  const s = stratified(c.ev, c.non);
  strat[t] = s;
  log(`${t}: D ${bp(s.D)} bp, t ${f2(s.t)}`);
  if (t === 'SPY')
    for (const p of s.parts)
      log(
        `   ${WEEKDAYS[p.w]}: events ${pad(p.nE, 3)} mean ${pad(bp(p.mE), 6)} | N ${pad(p.nN, 4)} mean ${pad(bp(p.mN), 6)} | diff ${pad(bp(p.d), 6)}`,
      );
}
{
  const c = prim.SPY;
  const fri = welch(
    c.ev.filter((r) => r.w === 5).map((r) => r.x),
    c.non.filter((r) => r.w === 5).map((r) => r.x),
  );
  const nonFri = welch(
    c.ev.filter((r) => r.w !== 5).map((r) => r.x),
    c.non.filter((r) => r.w !== 5).map((r) => r.x),
  );
  log(`SPY Friday events vs Friday N: ${bp(fri.diff)} bp, t ${f2(fri.t)}; non-Friday events vs non-Friday N: ${bp(nonFri.diff)} bp, t ${f2(nonFri.t)}`);
  const allByWd = [1, 2, 3, 4, 5].map((w) => `${WEEKDAYS[w]} ${bp(mean(c.non.filter((r) => r.w === w).map((r) => r.x)))}`);
  log(`SPY N mean by weekday (bp): ${allByWd.join(', ')}`);
}

// Per year.
log('\n## SPY per year: E mean, N mean, difference (bp)');
const yearDiff = {};
for (const y of [...FULL_YEARS, '2026']) {
  const a = prim.SPY.ev.filter((r) => r.y === y).map((r) => r.x);
  const b = prim.SPY.non.filter((r) => r.y === y).map((r) => r.x);
  yearDiff[y] = mean(a) - mean(b);
  log(`${y}: n ${pad(a.length, 2)}  E ${pad(bp(mean(a)), 6)}  N ${pad(bp(mean(b)), 6)}  diff ${pad(bp(yearDiff[y]), 6)}`);
}
const yearsPos = FULL_YEARS.filter((y) => yearDiff[y] > 0).length;
log(`Full years with diff > 0: ${yearsPos}/10`);
for (const t of ['QQQ', 'IWM']) {
  const yp = FULL_YEARS.filter((y) => {
    const a = prim[t].ev.filter((r) => r.y === y).map((r) => r.x);
    const b = prim[t].non.filter((r) => r.y === y).map((r) => r.x);
    return mean(a) > mean(b);
  }).length;
  log(`${t} full years with diff > 0: ${yp}/10`);
}

// Concentration.
log('\n## SPY concentration');
const sortedE = [...prim.SPY.ev].sort((p, q) => q.x - p.x);
log(`5 best event days: ${sortedE.slice(0, 5).map((r) => `${r.d} ${bp(r.x, 0)}`).join(', ')}`);
log(`5 worst event days: ${sortedE.slice(-5).reverse().map((r) => `${r.d} ${bp(r.x, 0)}`).join(', ')}`);
const no5 = welch(sortedE.slice(5).map((r) => r.x), prim.SPY.b);
log(`Without the 5 best event days: diff ${bp(no5.diff)} bp, t ${f2(no5.t)}`);
const no5worst = welch(sortedE.slice(5, -5).map((r) => r.x), prim.SPY.b);
log(`Without the 5 best and 5 worst event days (info): diff ${bp(no5worst.diff)} bp, t ${f2(no5worst.t)}`);
{
  // Trim both sets symmetrically at 1% / 99% for info.
  const trim = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    const k = Math.floor(s.length * p);
    return s.slice(k, s.length - k);
  };
  const tr = welch(trim(prim.SPY.a, 0.02), trim(prim.SPY.b, 0.02));
  log(`Both sets trimmed 2% each tail (info): diff ${bp(tr.diff)} bp, t ${f2(tr.t)}`);
}

// --- pass rule -------------------------------------------------------------------------------------
const r1 = prim.SPY.diff > 0 && prim.SPY.t >= 2;
const r2 = strat.SPY.D > 0 && strat.SPY.t >= 1.5;
const r3 = prim.QQQ.diff > 0 && prim.IWM.diff > 0;
const r4 = yearsPos >= 6;
const r5 = no5.diff > 0;
log('\n## Pass rule');
log(`1. SPY diff ${bp(prim.SPY.diff)} bp, t ${f2(prim.SPY.t)} (> 0, t ≥ 2): ${r1 ? 'yes' : 'no'}`);
log(`2. SPY same-weekday D ${bp(strat.SPY.D)} bp, t ${f2(strat.SPY.t)} (> 0, t ≥ 1.5): ${r2 ? 'yes' : 'no'}`);
log(`3. QQQ diff ${bp(prim.QQQ.diff)}, IWM diff ${bp(prim.IWM.diff)} (both > 0): ${r3 ? 'yes' : 'no'}`);
log(`4. SPY years positive ${yearsPos}/10 (≥ 6): ${r4 ? 'yes' : 'no'}`);
log(`5. SPY diff without 5 best ${bp(no5.diff)} (> 0): ${r5 ? 'yes' : 'no'}`);
let verdict;
if (r1 && r2 && r3 && r4 && r5) verdict = 'PASS';
else if (prim.SPY.diff <= 0 || prim.SPY.t < 1 || strat.SPY.D <= 0) verdict = 'FAIL';
else verdict = 'INCONCLUSIVE';
log(`Effect verdict: ${verdict}`);

// --- strategy --------------------------------------------------------------------------------------
const spyBars = daily('SPY');
/** 1-minute price at 16:01 (close of the bar starting at the session close). */
const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const minuteCache = new Map();
function priceAfterClose(d) {
  if (minuteCache.has(d)) return minuteCache.get(d);
  const f = `${dataDir}/stocks/SPY/${d}.json`;
  let p = null;
  if (existsSync(f)) {
    const bars = JSON.parse(readFileSync(f, 'utf8'));
    const ct = closeTime.get(d) ?? '16:00';
    const b = bars.find((x) => nyFmt.format(new Date(x.t)) === ct);
    if (b) p = { auction: b.o, after: b.c };
  }
  minuteCache.set(d, p);
  return p;
}

/**
 * Daily total returns of: in SPY on days in `held` (bought at the previous close), BIL (or cash) otherwise.
 * costBps per side; each switch is 2 sides with BIL, 1 side with cash.
 */
function strategy(held, costBps, { cash = false, lateFill = false } = {}) {
  const out = [];
  const sidesPerSwitch = cash ? 1 : 2;
  let lateMissing = 0;
  for (const d of sampleDays) {
    const i = idx.get(d);
    const prevD = tradingDays[i - 1];
    const nextD = tradingDays[i + 1];
    const bil = bilRet.get(d);
    if (!held.has(d)) {
      out.push({ d, total: cash ? 0 : bil, bil, inSpy: false });
      continue;
    }
    let r = spyBars.get(d).c / spyBars.get(prevD).c - 1;
    if (lateFill) {
      // Entry at 16:01 on prevD if prevD isn't held; exit at 16:01 on d if nextD isn't held.
      const enterLate = !held.has(prevD);
      const exitLate = !held.has(nextD);
      const pPrev = enterLate ? priceAfterClose(prevD) : null;
      const pNow = exitLate ? priceAfterClose(d) : null;
      if ((enterLate && !pPrev) || (exitLate && !pNow)) lateMissing++;
      else {
        // Convert to the adjusted scale via the ratio to the auction print.
        const entry = enterLate ? spyBars.get(prevD).c * (pPrev.after / pPrev.auction) : spyBars.get(prevD).c;
        const exit = exitLate ? spyBars.get(d).c * (pNow.after / pNow.auction) : spyBars.get(d).c;
        r = exit / entry - 1;
      }
    }
    if (!held.has(prevD)) r -= (sidesPerSwitch * costBps) / 10_000;
    if (!held.has(nextD)) r -= (sidesPerSwitch * costBps) / 10_000;
    out.push({ d, total: r, bil, inSpy: true });
  }
  return { days: out, lateMissing };
}
function performance(days) {
  const ex = days.map((x) => x.total - x.bil);
  const sharpe = (mean(ex) / sd(ex)) * Math.sqrt(252);
  let v = 1;
  let peak = 1;
  let maxDd = 0;
  for (const x of days) {
    v *= 1 + x.total;
    peak = Math.max(peak, v);
    maxDd = Math.min(maxDd, v / peak - 1);
  }
  const years = days.length / 252;
  return { sharpe, cagr: v ** (1 / years) - 1, maxDd, exAnn: mean(ex) * 252, t: (mean(ex) / sd(ex)) * Math.sqrt(ex.length) };
}

log('\n## Strategy: SPY from the close before each event to the event-day close (MOC), BIL otherwise');
const hold = performance(
  sampleDays.map((d) => {
    const i = idx.get(d);
    return { d, total: spyBars.get(d).c / spyBars.get(tradingDays[i - 1]).c - 1, bil: bilRet.get(d) };
  }),
);
log(`SPY buy & hold                 Sharpe ${f2(hold.sharpe)}  CAGR ${(hold.cagr * 100).toFixed(1)}%  excess ${(hold.exAnn * 100).toFixed(1)}%/yr  max DD ${(hold.maxDd * 100).toFixed(1)}%`);
const bilOnly = performance(sampleDays.map((d) => ({ d, total: bilRet.get(d), bil: bilRet.get(d) })));
log(`BIL only                       CAGR ${(bilOnly.cagr * 100).toFixed(2)}%`);
const stratRes = {};
const showStrat = (label, s) => {
  const p = performance(s.days);
  log(
    `${padr(label, 31)}Sharpe ${f2(p.sharpe)}  t ${f2(p.t)}  CAGR ${(p.cagr * 100).toFixed(2)}%  excess ${(p.exAnn * 100).toFixed(2)}%/yr  max DD ${(p.maxDd * 100).toFixed(1)}%${s.lateMissing ? `  (late-fill events without minute data: ${s.lateMissing})` : ''}`,
  );
  return p;
};
for (const c of [0, 0.3, 1, 2, 5]) stratRes[c] = showStrat(`E, ${c} bp/side`, strategy(E, c));
log('Information only:');
showStrat('E, cash when out, 2 bp/side', strategy(E, 2, { cash: true }));
showStrat('E, cash when out, 0.3 bp/side', strategy(E, 0.3, { cash: true }));
showStrat('E, 16:01 fills, 0 bp', strategy(E, 0, { lateFill: true }));
showStrat('E, 16:01 fills, 2 bp/side', strategy(E, 2, { lateFill: true }));
showStrat('E ∪ FOMC, 2 bp/side', strategy(ALL_ANN, 2));
showStrat('E ∪ FOMC, 5 bp/side', strategy(ALL_ANN, 5));
{
  const spy = records('SPY');
  const sumAll = spy.reduce((a, r) => a + r.x, 0);
  const sumE = spy.filter((r) => E.has(r.d)).reduce((a, r) => a + r.x, 0);
  const sumAA = spy.filter((r) => ALL_ANN.has(r.d)).reduce((a, r) => a + r.x, 0);
  log(
    `Share of buy & hold's summed excess return earned on E days: ${((sumE / sumAll) * 100).toFixed(1)}% (E is ${((E.size / spy.length) * 100).toFixed(1)}% of days); on E ∪ FOMC: ${((sumAA / sumAll) * 100).toFixed(1)}% (${((ALL_ANN.size / spy.length) * 100).toFixed(1)}% of days)`,
  );
}
const exists = verdict === 'PASS';
const worth = exists && stratRes[2].sharpe >= hold.sharpe && stratRes[5].sharpe > 0;
log(
  `Worth trading (effect exists, Sharpe at 2 bp ≥ buy & hold ${f2(hold.sharpe)}, Sharpe at 5 bp > 0): ${worth ? 'YES' : 'NO'} (2 bp ${f2(stratRes[2].sharpe)}, 5 bp ${f2(stratRes[5].sharpe)})`,
);

// --- information only ------------------------------------------------------------------------------
log('\n## Information only (excess bp/day unless stated; diff vs N; Welch t)');
const info = (label, ticker, evPred, nonPred = isN, key = 'x') => {
  const c = compare(ticker, evPred, nonPred, key);
  log(
    `${padr(label, 52)}${padr(ticker, 4)} nE ${pad(c.a.length, 3)}  E ${pad(bp(mean(c.a)), 6)}  N ${pad(bp(mean(c.b)), 6)}  diff ${pad(bp(c.diff), 6)}  t ${pad(f2(c.t), 5)}  sdE ${pad(bp(sd(c.a), 0), 4)} sdN ${pad(bp(sd(c.b), 0), 4)}`,
  );
  return c;
};
for (const t of ['SPY', 'QQQ', 'IWM']) {
  info('#1 CPI days alone', t, (d) => CPI.has(d));
  info('#2 Jobs days alone', t, (d) => JOBS.has(d));
}
{
  const c = compare('SPY', (d) => JOBS.has(d), isN);
  const s = stratified(c.ev, c.non);
  log(`   SPY jobs alone, same-weekday D ${bp(s.D)} bp, t ${f2(s.t)}`);
  const c2 = compare('SPY', (d) => CPI.has(d), isN);
  const s2 = stratified(c2.ev, c2.non);
  log(`   SPY CPI alone, same-weekday D ${bp(s2.D)} bp, t ${f2(s2.t)}`);
}
for (const t of ['SPY', 'QQQ', 'IWM']) {
  info('#3 Overnight, prev close -> open (raw)', t, (d) => E.has(d), isN, 'on');
  info('#4 Intraday, open -> close (raw)', t, (d) => E.has(d), isN, 'id');
}
{
  for (const [lab, key] of [
    ['overnight', 'on'],
    ['intraday', 'id'],
  ]) {
    const c = compare('SPY', (d) => E.has(d), isN, key);
    const s = stratified(c.ev, c.non, key);
    log(`   SPY ${lab}, same-weekday D ${bp(s.D)} bp, t ${f2(s.t)}`);
  }
  for (const [lab, set] of [
    ['CPI', CPI],
    ['jobs', JOBS],
  ]) {
    const on = compare('SPY', (d) => set.has(d), isN, 'on');
    const id = compare('SPY', (d) => set.has(d), isN, 'id');
    log(`   SPY ${lab}: overnight diff ${bp(on.diff)} (t ${f2(on.t)}), intraday diff ${bp(id.diff)} (t ${f2(id.t)})`);
  }
}
for (const t of ['IEF', 'TLT']) {
  const c = info('#5/#6 Bonds, E', t, (d) => E.has(d));
  const s = stratified(c.ev, c.non);
  log(`   ${t} same-weekday D ${bp(s.D)} bp, t ${f2(s.t)}`);
  info('   bonds, CPI alone', t, (d) => CPI.has(d));
  info('   bonds, jobs alone', t, (d) => JOBS.has(d));
}
for (const t of ['SPY', 'QQQ', 'IWM']) {
  const early = (d) => d < '2021-01-01';
  const c1 = info('#7 2016-2020', t, (d) => E.has(d) && early(d), (d) => isN(d) && early(d));
  const c2 = info('#8 2021-2026', t, (d) => E.has(d) && !early(d), (d) => isN(d) && !early(d));
  if (t === 'SPY') {
    log(`   SPY 2016-2020 same-weekday D ${bp(stratified(c1.ev, c1.non).D)} bp, t ${f2(stratified(c1.ev, c1.non).t)}`);
    log(`   SPY 2021-2026 same-weekday D ${bp(stratified(c2.ev, c2.non).D)} bp, t ${f2(stratified(c2.ev, c2.non).t)}`);
    for (const [lab, set] of [
      ['CPI', CPI],
      ['jobs', JOBS],
    ]) {
      info(`   ${lab} 2016-2020`, t, (d) => set.has(d) && early(d), (d) => isN(d) && early(d));
      info(`   ${lab} 2021-2026`, t, (d) => set.has(d) && !early(d), (d) => isN(d) && !early(d));
    }
  }
}
{
  const inf = (d) => d >= '2021-01-01' && d < '2024-01-01';
  info('#9 CPI 2021-2023 alone', 'SPY', (d) => CPI.has(d) && inf(d), (d) => isN(d) && inf(d));
  const c = compare('SPY', (d) => CPI.has(d) && inf(d), (d) => true);
  log(`   SPY CPI 2021-2023: ${c.a.length} days, sd ${bp(sd(c.a), 0)} bp vs N same years sd ${bp(sd(compare('SPY', () => false, (d) => isN(d) && inf(d)).b), 0)} bp`);
}
for (const t of ['SPY', 'QQQ', 'IWM', 'IEF', 'TLT']) {
  const c = info('#10 FOMC days (close-to-close)', t, (d) => FOMC.has(d));
  if (t === 'SPY') {
    const wedN = c.non.filter((r) => r.w === 3).map((r) => r.x);
    const fw = welch(c.a, wedN);
    log(`   SPY FOMC vs non-announcement Wednesdays: diff ${bp(fw.diff)} bp, t ${f2(fw.t)}`);
  }
}
for (const t of ['SPY', 'QQQ', 'IWM']) {
  const c = info('#11 All announcement days (E ∪ FOMC)', t, (d) => ALL_ANN.has(d));
  if (t === 'SPY') {
    const s = stratified(c.ev, c.non);
    log(`   SPY E ∪ FOMC same-weekday D ${bp(s.D)} bp, t ${f2(s.t)}`);
  }
}
info('#12 E vs all other days (FOMC left in)', 'SPY', (d) => E.has(d), (d) => !E.has(d));
{
  const c = info('#13 Good Friday events dropped', 'SPY', (d) => EDrop.has(d), isNDrop);
  const s = stratified(c.ev, c.non);
  log(`   same-weekday D ${bp(s.D)} bp, t ${f2(s.t)}`);
  const goodFriMondays = [...E].filter((d) => !EDrop.has(d));
  const spy = records('SPY');
  log(`   the moved events: ${goodFriMondays.map((d) => `${d} ${bp(spy.find((r) => r.d === d).x, 0)}`).join(', ')}`);
}
{
  const before = new Set([...E].map((d) => tradingDays[idx.get(d) - 1]).filter((d) => d >= FROM && !E.has(d)));
  const after = new Set([...E].map((d) => tradingDays[idx.get(d) + 1]).filter((d) => d && d <= TO && !E.has(d)));
  for (const t of ['SPY', 'QQQ', 'IWM']) {
    info('#14 Placebo: trading day before each event', t, (d) => before.has(d) && isN(d), (d) => isN(d) && !before.has(d));
    info('#15 Placebo: trading day after each event', t, (d) => after.has(d) && isN(d), (d) => isN(d) && !after.has(d));
  }
}
log('#16-#18: see the strategy section above.');
log(`\nConfigs: 1 primary + 18 information only = 19.`);
