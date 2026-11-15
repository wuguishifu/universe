// H3: Zarattini–Aziz–Barbon (2024) noise-area breakout traded in shares, from raw 1-minute bars.
// Design and pass rule: research/hypotheses/h3.md.
//
// usage:
//   node research/tools/h3-noise-shares.mjs [data dir]                 full report
//   node research/tools/h3-noise-shares.mjs [data dir] --check SPY 2025-03-04
//        prints every check of one day for the primary config, and recomputes that day's band
//        independently from the files on disk (slow path) to confirm the fast one.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK =
  checkIdx >= 0 ? { ticker: args[checkIdx + 1], date: args[checkIdx + 2] } : null;
const LAST_DATE = '2026-11-13';
const TICKERS = ['SPY', 'QQQ', 'IWM'];
const SAMPLES = {
  A: { from: '2016-01-01', to: '2024-02-29', label: 'A 2016-01 → 2024-02 (overlaps paper)' },
  B: { from: '2024-03-01', to: LAST_DATE, label: 'B 2024-03 → 2026-11 (post-paper)' },
  F: { from: '2016-01-01', to: LAST_DATE, label: 'Full 2016-01 → 2026-11' },
};
const COSTS = ['zero', 'paper', 'primary', 'stress'];
const BP = { zero: 0, primary: 1e-4, stress: 2e-4 };
const PAPER_PER_SHARE = 0.0035 + 0.001;

// --- time helpers ------------------------------------------------------------------------------

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
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date <= LAST_DATE,
);

// --- loading -----------------------------------------------------------------------------------

/**
 * One regular session as minute arrays indexed by k = minutes after the open:
 *   C[k]   close of the last bar starting at or before open+k (forward-filled)
 *   Oat[k] open of the bar starting exactly at open+k, NaN if none
 *   PV[k], V[k] cumulative hlc3·volume and volume over bars starting at or before open+k
 * Price at decision time T (minutes after the open) is C[T-1]; VWAP at T is PV[T-1]/V[T-1].
 */
function loadSession(ticker, day) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const midnight = nyMidnight(day.date);
  const open = hhmm(day.open);
  const n = hhmm(day.close) - open;
  const bars = JSON.parse(readFileSync(path, 'utf8'))
    .map((b) => ({ k: (Date.parse(b.t) - midnight) / 60_000 - open, ...b }))
    .filter((b) => b.k >= 0 && b.k < n)
    .sort((a, b) => a.k - b.k);
  if (!bars.length || bars[0].k !== 0) return { bad: true };
  const C = new Float64Array(n);
  const Oat = new Float64Array(n).fill(NaN);
  const PV = new Float64Array(n);
  const V = new Float64Array(n);
  let j = 0;
  let c = bars[0].c,
    pv = 0,
    v = 0,
    missing = 0;
  for (let k = 0; k < n; k++) {
    if (j < bars.length && bars[j].k === k) {
      const b = bars[j++];
      c = b.c;
      Oat[k] = b.o;
      pv += ((b.h + b.l + b.c) / 3) * b.v;
      v += b.v;
    } else missing++;
    C[k] = c;
    PV[k] = pv;
    V[k] = v;
  }
  return { date: day.date, n, O: bars[0].o, C, Oat, PV, V, last: C[n - 1], missing };
}

function loadTicker(ticker) {
  const sessions = []; // aligned with calendar; null = no data
  let bad = 0,
    missingMinutes = 0;
  for (const day of calendar) {
    const s = loadSession(ticker, day);
    if (s?.bad) {
      bad++;
      sessions.push(null);
      continue;
    }
    if (s) missingMinutes += s.missing;
    sessions.push(s);
  }
  // σ_d: sample sd of the last 14 close-to-close returns between consecutive sessions, ending
  // with yesterday's close.
  const sigmaD = new Array(calendar.length).fill(undefined);
  const rets = [];
  for (let i = 0; i < calendar.length; i++) {
    if (rets.length >= 14) {
      const w = rets.slice(-14);
      const mu = w.reduce((a, b) => a + b, 0) / 14;
      sigmaD[i] = Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / 13);
    }
    if (sessions[i] && i > 0 && sessions[i - 1])
      rets.push(sessions[i].last / sessions[i - 1].last - 1);
  }
  return { ticker, sessions, sigmaD, bad, missingMinutes };
}

// --- simulation --------------------------------------------------------------------------------

/**
 * cfg: { L, every, m, exit: 'band'|'vwap', sizing: 'vol'|'1x', longOnly, leak }
 * leak (diagnostic only): decide on the close of the bar *starting* at T but still fill at its
 * open — a deliberate one-minute lookahead, to see how much a leak would be worth.
 * Returns per eligible day: { date, year, r: {cost: return}, trips: [{net primary}], traded }.
 */
function simulate(data, cfg) {
  const { sessions, sigmaD } = data;
  const history = new Map(); // T -> past |C[T-1]/O - 1|, oldest first, length ≤ L
  const days = [];
  let skippedFills = 0,
    notReady = 0,
    staleGap = 0;
  for (let i = 0; i < calendar.length; i++) {
    const s = sessions[i];
    if (!s) continue;
    const checks = [];
    for (let T = cfg.every; T <= s.n - cfg.every; T += cfg.every) checks.push(T);
    const prev = i > 0 ? sessions[i - 1] : null;
    const ready =
      prev &&
      sigmaD[i] !== undefined &&
      checks.length &&
      (history.get(checks[0])?.length ?? 0) >= cfg.L;
    if (!prev) staleGap++;
    else if (!ready) notReady++;
    if (ready) {
      const lev = cfg.sizing === 'vol' ? Math.min(4, 0.02 / sigmaD[i]) : 1;
      const scale = lev / s.O; // daily return per $1 of per-share P&L
      const hi = Math.max(s.O, prev.last);
      const lo = Math.min(s.O, prev.last);
      let pos = 0,
        entry = 0;
      let gross = 0,
        shares = 0, // Σ |Δpos| (per unit of `scale`)
        notional = 0; // Σ |Δpos| × fill price
      const trips = [];
      const log = [];
      const trade = (target, price) => {
        if (pos !== 0) {
          gross += pos * (price - entry);
          trips.push(pos * (price - entry) - BP.primary * (entry + price));
        }
        const d = Math.abs(target - pos);
        shares += d;
        notional += d * price;
        pos = target;
        entry = price;
      };
      for (const T of checks) {
        const past = history.get(T);
        if (!past || past.length < cfg.L) continue; // half-day tail etc.
        const sigma = past.reduce((a, b) => a + b, 0) / past.length;
        const ub = hi * (1 + cfg.m * sigma);
        const lb = lo * (1 - cfg.m * sigma);
        const idx = cfg.leak ? T : T - 1;
        const p = s.C[idx];
        const vwap = s.V[idx] > 0 ? s.PV[idx] / s.V[idx] : p;
        let target;
        const up = p > Math.max(ub, vwap);
        const down = p < Math.min(lb, vwap);
        if (cfg.exit === 'band' || pos === 0) target = up ? 1 : down ? -1 : 0;
        else if (pos === 1) target = down ? -1 : p < vwap ? 0 : 1;
        else target = up ? 1 : p > vwap ? 0 : -1;
        if (cfg.longOnly && target === -1) target = 0;
        if (CHECK) log.push({ T, p, ub, lb, vwap, sigma, target });
        if (target === pos) continue;
        let fill;
        for (let k = T; k < Math.min(T + 5, s.n); k++)
          if (!Number.isNaN(s.Oat[k])) {
            fill = s.Oat[k];
            break;
          }
        if (fill === undefined) {
          skippedFills++;
          continue;
        }
        trade(target, fill);
        if (CHECK) log.at(-1).fill = fill;
      }
      if (pos !== 0) trade(0, s.last);
      const r = {};
      for (const c of COSTS) {
        const cost = c === 'paper' ? shares * PAPER_PER_SHARE : notional * BP[c];
        r[c] = scale * (gross - cost);
      }
      days.push({
        date: s.date,
        year: s.date.slice(0, 4),
        r,
        trips: trips.length,
        wins: trips.filter((x) => x > 0).length,
        traded: shares > 0,
        lev,
        O: s.O,
        log,
        hi,
        lo,
      });
    }
    // Only after the day is done: add today's moves to the history.
    for (let T = cfg.every; T < s.n; T += cfg.every) {
      const past = history.get(T) ?? [];
      past.push(Math.abs(s.C[T - 1] / s.O - 1));
      if (past.length > cfg.L) past.shift();
      history.set(T, past);
    }
  }
  return { days, skippedFills, notReady, staleGap };
}

// --- statistics --------------------------------------------------------------------------------

function stats(rs) {
  const n = rs.length;
  if (!n) return null;
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let eq = 1,
    peak = 1,
    mdd = 0;
  for (const r of rs) {
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  return {
    n,
    mean,
    sd,
    cagr: eq ** (252 / n) - 1,
    vol: sd * Math.sqrt(252),
    sharpe: (mean / sd) * Math.sqrt(252),
    t: (mean / sd) * Math.sqrt(n),
    mdd,
    worst: Math.min(...rs),
  };
}
const without5Best = (rs) => {
  const sorted = [...rs].sort((a, b) => b - a).slice(5);
  return stats(sorted);
};
const corr = (a, b) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};

/** Buy-and-hold close-to-close returns from adjusted daily bars, keyed by date. */
const buyHold = {};
for (const t of TICKERS) {
  const daily = JSON.parse(readFileSync(`${dataDir}/daily/${t}.json`, 'utf8'));
  const m = new Map();
  for (let i = 1; i < daily.length; i++) {
    const date = new Date(Date.parse(daily[i].t) + 12 * 3600_000).toISOString().slice(0, 10);
    m.set(date, daily[i].c / daily[i - 1].c - 1);
  }
  buyHold[t] = m;
}

const pct = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const f2 = (x) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(2));
const pad = (s, w) => String(s).padStart(w);
const padE = (s, w) => String(s).padEnd(w);

function slice(days, from, to) {
  return days.filter((d) => d.date >= from && d.date <= to);
}

function summary(days, cost) {
  const rs = days.map((d) => d.r[cost]);
  const st = stats(rs);
  if (!st) return null;
  const trips = days.reduce((a, d) => a + d.trips, 0);
  // hit rate per round trip after primary costs (computed in simulate)
  const wins = days.reduce((a, d) => a + d.wins, 0);
  const years = days.length / 252;
  const w5 = without5Best(rs);
  return {
    ...st,
    tripsPerYear: trips / years,
    hit: trips ? wins / trips : NaN,
    tradedDays: days.filter((d) => d.traded).length / days.length,
    w5,
  };
}

function bhSummary(ticker, days) {
  const rs = days.map((d) => buyHold[ticker].get(d.date)).filter((x) => x !== undefined);
  return stats(rs);
}

// --- configs -----------------------------------------------------------------------------------

const P = { L: 14, every: 30, m: 1, exit: 'band', sizing: 'vol' };
const GRID = [
  { name: 'P  L14·30m·m1·band+vwap·vol', ...P, primary: true },
  { name: '2  L30', ...P, L: 30 },
  { name: '3  L60', ...P, L: 60 },
  { name: '4  L90', ...P, L: 90 },
  { name: '5  15m checks', ...P, every: 15 },
  { name: '6  10m checks', ...P, every: 10 },
  { name: '7  m1.5', ...P, m: 1.5 },
  { name: '8  VWAP-only exit', ...P, exit: 'vwap' },
  { name: '9  10m·m1.5·VWAP-only', ...P, every: 10, m: 1.5, exit: 'vwap' },
  { name: '10 P at 1x notional', ...P, sizing: '1x' },
];

// --- main --------------------------------------------------------------------------------------

const data = {};
const tickersToLoad = CHECK ? [CHECK.ticker] : TICKERS;
for (const t of tickersToLoad) data[t] = loadTicker(t);

if (CHECK) {
  const { ticker, date } = CHECK;
  const res = simulate(data[ticker], P);
  const day = res.days.find((d) => d.date === date);
  if (!day) throw new Error('day not eligible');
  console.log(`${ticker} ${date}: lev ${day.lev.toFixed(3)}, hi ${day.hi}, lo ${day.lo}`);
  for (const l of day.log)
    console.log(
      `T+${pad(l.T, 3)}  p ${l.p.toFixed(3)}  ub ${l.ub.toFixed(3)}  lb ${l.lb.toFixed(3)}  vwap ${l.vwap.toFixed(3)}  σ ${(l.sigma * 100).toFixed(4)}%  → ${l.target}${l.fill !== undefined ? `  fill ${l.fill}` : ''}`,
    );
  console.log('returns', day.r, 'trips', day.trips);
  // Slow independent path: read the 14 previous sessions' files directly and recompute σ and the
  // band at each check from raw bars (bar ending at T = bar starting at T-1, by wall clock).
  const ci = calendar.findIndex((d) => d.date === date);
  const past = [];
  for (let i = ci - 1; i >= 0 && past.length < 14; i--) {
    const p = `${dataDir}/stocks/${ticker}/${calendar[i].date}.json`;
    if (!existsSync(p)) continue;
    past.push({ day: calendar[i], bars: JSON.parse(readFileSync(p, 'utf8')) });
  }
  const at = (bars, date, hm) => {
    const mid = nyMidnight(date);
    let best;
    for (const b of bars) {
      const m = (Date.parse(b.t) - mid) / 60000;
      if (m >= hhmm('09:30') && m <= hm) best = b;
    }
    return best;
  };
  const todayBars = JSON.parse(readFileSync(`${dataDir}/stocks/${ticker}/${date}.json`, 'utf8'));
  const O = at(todayBars, date, hhmm('09:30')).o;
  const prevDay = calendar[ci - 1];
  const prevBars = JSON.parse(readFileSync(`${dataDir}/stocks/${ticker}/${prevDay.date}.json`, 'utf8'));
  const prevClose = at(prevBars, prevDay.date, hhmm(prevDay.close) - 1).c;
  console.log(`slow path: O ${O}, prevClose ${prevClose}, past sessions ${past.map((x) => x.day.date).join(' ')}`);
  for (const l of day.log) {
    const hm = hhmm('09:30') + l.T - 1;
    const moves = past.map(({ day: d, bars }) => {
      const o = at(bars, d.date, hhmm('09:30')).o;
      return Math.abs(at(bars, d.date, hm).c / o - 1);
    });
    const sigma = moves.reduce((a, b) => a + b, 0) / moves.length;
    const ub = Math.max(O, prevClose) * (1 + sigma);
    const p = at(todayBars, date, hm).c;
    console.log(
      `T+${pad(l.T, 3)}  slow p ${p.toFixed(3)} ub ${ub.toFixed(3)} σ ${(sigma * 100).toFixed(4)}%  ${Math.abs(ub - l.ub) < 1e-9 && p === l.p ? 'match' : 'MISMATCH'}`,
    );
  }
  process.exit(0);
}

const out = [];
const say = (s = '') => {
  out.push(s);
  console.log(s);
};

say('H3 — noise-area breakout in shares (Zarattini, Aziz & Barbon 2024). Design: research/hypotheses/h3.md');
for (const t of TICKERS)
  say(
    `${t}: ${data[t].sessions.filter(Boolean).length} sessions loaded, ${data[t].bad} dropped (no bar at the open), ${data[t].missingMinutes} missing minutes forward-filled`,
  );
say();

const results = {};
for (const cfg of GRID)
  for (const longOnly of [false, true]) {
    const key = `${cfg.name}${longOnly ? ' [LO]' : ''}`;
    results[key] = {};
    for (const t of TICKERS) results[key][t] = simulate(data[t], { ...cfg, longOnly });
  }
// Diagnostic, not a config: the same primary rule with a deliberate one-minute lookahead.
const leak = {};
for (const t of TICKERS) leak[t] = simulate(data[t], { ...P, leak: true });

const pKey = GRID[0].name;
const header = `${padE('', 26)}${pad('days', 6)}${pad('CAGR', 8)}${pad('vol', 7)}${pad('Sharpe', 8)}${pad('t', 7)}${pad('maxDD', 8)}${pad('worst', 7)}${pad('trips/y', 8)}${pad('hit', 6)}${pad('traded', 7)}${pad('w/o5best', 9)}${pad('t w/o5', 7)}`;
const row = (label, s) =>
  s
    ? `${padE(label, 26)}${pad(s.n, 6)}${pad(pct(s.cagr), 8)}${pad(pct(s.vol), 7)}${pad(f2(s.sharpe), 8)}${pad(f2(s.t), 7)}${pad(pct(s.mdd), 8)}${pad(pct(s.worst), 7)}${pad(s.tripsPerYear?.toFixed(0) ?? '', 8)}${pad(s.hit !== undefined ? pct(s.hit, 0) : '', 6)}${pad(s.tradedDays !== undefined ? pct(s.tradedDays, 0) : '', 7)}${pad(s.w5 ? pct(s.w5.cagr) : '', 9)}${pad(s.w5 ? f2(s.w5.t) : '', 7)}`
    : `${padE(label, 26)} —`;

for (const lo of [false, true]) {
  const key = `${pKey}${lo ? ' [LO]' : ''}`;
  say(`=== PRIMARY ${lo ? 'LONG-ONLY' : 'LONG-SHORT'}: ${key} ===`);
  for (const t of TICKERS) {
    const r = results[key][t];
    say(`--- ${t} (skipped fills ${r.skippedFills}, days not ready ${r.notReady}, days skipped for a data gap ${r.staleGap})`);
    for (const smp of Object.values(SAMPLES)) {
      const days = slice(r.days, smp.from, smp.to);
      say(`  ${smp.label}: ${days[0]?.date} → ${days.at(-1)?.date}`);
      say(`  ${header}`);
      for (const c of COSTS) say(`  ${row(c, summary(days, c))}`);
      const bh = bhSummary(t, days);
      say(`  ${row(`buy & hold ${t}`, bh)}`);
      const pairs = days.filter((d) => buyHold[t].has(d.date));
      say(
        `  ${padE('corr with B&H (primary)', 26)}${f2(corr(pairs.map((d) => d.r.primary), pairs.map((d) => buyHold[t].get(d.date))))}   mean leverage ${f2(days.reduce((a, d) => a + d.lev, 0) / days.length)}`,
      );
      say();
    }
    // per year
    say(`  per year (primary costs; zero-cost Sharpe; buy & hold):`);
    say(`  ${padE('year', 6)}${pad('days', 5)}${pad('return', 9)}${pad('Sharpe', 8)}${pad('t', 7)}${pad('maxDD', 8)}${pad('0-cost Sh', 10)}${pad('paper Sh', 9)}${pad('B&H', 8)}`);
    const years = [...new Set(r.days.map((d) => d.year))];
    for (const y of years) {
      const days = r.days.filter((d) => d.year === y);
      const s = stats(days.map((d) => d.r.primary));
      const z = stats(days.map((d) => d.r.zero));
      const pp = stats(days.map((d) => d.r.paper));
      const ret = days.reduce((a, d) => a * (1 + d.r.primary), 1) - 1;
      const bh = days.reduce((a, d) => a * (1 + (buyHold[t].get(d.date) ?? 0)), 1) - 1;
      say(`  ${padE(y, 6)}${pad(days.length, 5)}${pad(pct(ret), 9)}${pad(f2(s.sharpe), 8)}${pad(f2(s.t), 7)}${pad(pct(s.mdd), 8)}${pad(f2(z.sharpe), 10)}${pad(f2(pp.sharpe), 9)}${pad(pct(bh), 8)}`);
    }
    say();
  }
}

say('=== GRID (information only except P): Sharpe / t / CAGR at primary costs ===');
say(`${padE('config', 34)}${TICKERS.map((t) => pad(`${t} A`, 20) + pad(`${t} B`, 20)).join('')}`);
for (const key of Object.keys(results)) {
  let line = padE(key, 34);
  for (const t of TICKERS)
    for (const sk of ['A', 'B']) {
      const s = summary(slice(results[key][t].days, SAMPLES[sk].from, SAMPLES[sk].to), 'primary');
      line += pad(`${f2(s.sharpe)}/${f2(s.t)}/${pct(s.cagr, 0)}`, 20);
    }
  say(line);
}
say();
say('Grid at stress costs (Sharpe / t):');
for (const key of Object.keys(results)) {
  let line = padE(key, 34);
  for (const t of TICKERS)
    for (const sk of ['A', 'B']) {
      const s = summary(slice(results[key][t].days, SAMPLES[sk].from, SAMPLES[sk].to), 'stress');
      line += pad(`${f2(s.sharpe)}/${f2(s.t)}`, 20);
    }
  say(line);
}
say();
say('Grid trips per year (A / B) and hit rate (B):');
for (const key of Object.keys(results)) {
  let line = padE(key, 34);
  for (const t of TICKERS) {
    const a = summary(slice(results[key][t].days, SAMPLES.A.from, SAMPLES.A.to), 'primary');
    const b = summary(slice(results[key][t].days, SAMPLES.B.from, SAMPLES.B.to), 'primary');
    line += pad(`${a.tripsPerYear.toFixed(0)}/${b.tripsPerYear.toFixed(0)} hit ${pct(b.hit, 0)}`, 22);
  }
  say(line);
}
say();

say('=== Diagnostic: primary with a deliberate 1-minute lookahead (decide on the bar ending T+1, fill at T) ===');
for (const t of TICKERS)
  for (const sk of ['A', 'B']) {
    const s = summary(slice(leak[t].days, SAMPLES[sk].from, SAMPLES[sk].to), 'primary');
    say(`  ${t} ${sk}: Sharpe ${f2(s.sharpe)}, t ${f2(s.t)}, CAGR ${pct(s.cagr)}`);
  }
say();

// --- pass rule ---------------------------------------------------------------------------------
function verdict(key) {
  const B = (t, c) => summary(slice(results[key][t].days, SAMPLES.B.from, SAMPLES.B.to), c);
  const spy = B('SPY', 'primary');
  const qqq = B('QQQ', 'primary');
  const stress = B('SPY', 'stress');
  const c1 = spy.cagr > 0 && spy.sharpe >= 0.7 && spy.t >= 1.5;
  const c2 = qqq.cagr > 0;
  const c3 = stress.cagr >= 0;
  const v =
    c1 && c2 && c3 ? 'PASS' : spy.cagr <= 0 || qqq.cagr <= 0 || stress.cagr < 0 ? 'FAIL' : 'INCONCLUSIVE';
  say(`${key}:`);
  say(`  1. SPY B primary: CAGR ${pct(spy.cagr)} (>0), Sharpe ${f2(spy.sharpe)} (≥0.7), t ${f2(spy.t)} (≥1.5) → ${c1 ? 'yes' : 'no'}`);
  say(`  2. QQQ B primary: CAGR ${pct(qqq.cagr)} (>0) → ${c2 ? 'yes' : 'no'}`);
  say(`  3. SPY B stress: CAGR ${pct(stress.cagr)} (≥0) → ${c3 ? 'yes' : 'no'}`);
  say(`  VERDICT: ${v}`);
}
say('=== Cost break-even for P (reporting only): per-side cost in bp of notional at which mean daily return = 0 ===');
say('    (costs are linear in bp, so break-even = mean(zero-cost) / (mean(zero) − mean(1 bp)); a 1-cent spread crossed by half = $0.005/share, shown in bp of the average price)');
for (const lo of [false, true])
  for (const t of TICKERS)
    for (const sk of ['A', 'B']) {
      const days = slice(results[`${pKey}${lo ? ' [LO]' : ''}`][t].days, SAMPLES[sk].from, SAMPLES[sk].to);
      const m0 = days.reduce((a, d) => a + d.r.zero, 0) / days.length;
      const m1 = days.reduce((a, d) => a + d.r.primary, 0) / days.length;
      const px = days.reduce((a, d) => a + d.O, 0) / days.length;
      say(`  ${lo ? 'LO' : 'LS'} ${t} ${sk}: break-even ${(m0 / (m0 - m1)).toFixed(2)} bp/side; zero-cost mean ${(m0 * 1e4).toFixed(2)} bp/day; cost drag ${((m0 - m1) * 1e4).toFixed(2)} bp/day per 1 bp/side; half a cent = ${((0.005 / px) * 1e4).toFixed(2)} bp`);
    }
say();

say('=== Replication gate: SPY, A, P long-short, paper costs: Sharpe ≥ 0.6 ===');
{
  const s = summary(slice(results[pKey].SPY.days, SAMPLES.A.from, SAMPLES.A.to), 'paper');
  say(`  Sharpe ${f2(s.sharpe)}, CAGR ${pct(s.cagr)}, maxDD ${pct(s.mdd)} → ${s.sharpe >= 0.6 ? 'PASS' : 'FAIL'}`);
}
say();
say('=== H3 pass rule (sample B) ===');
verdict(pKey);
say('Secondary (long-only, same tests):');
verdict(`${pKey} [LO]`);
