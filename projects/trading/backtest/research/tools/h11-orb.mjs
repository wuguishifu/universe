// H11: the 5-minute opening range breakout (Zarattini, Barbon & Aziz 2023) in shares, as published.
// Design and pass rule: research/hypotheses/h11.md (pre-registered before this ran).
//
// usage:
//   node research/tools/h11-orb.mjs [data dir] [--diag]               full report (--diag: post-hoc
//        diagnostics: no-financing sizing, per-year, timing leak/delay sensitivity)
//   node research/tools/h11-orb.mjs [data dir] --check QQQ 2025-03-04  one ticker-day, verbose
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK = checkIdx >= 0 ? { ticker: args[checkIdx + 1], date: args[checkIdx + 2] } : null;
const FIRST_DATE = '2016-01-04';
const LAST_DATE = '2026-11-13';
const A_END = '2023-05-31';
const B_START = '2023-06-01';
const TICKERS = ['QQQ', 'SPY', 'IWM'];
const COSTS = { zero: 0, primary: 1e-4, stress: 3e-4 };
const MAX_WAIT = 5; // minutes an entry may wait for a bar
const RISK = 0.01;
const MAX_LEV = 4;
const FIN_SPREAD = 0.02;

// --- time helpers ------------------------------------------------------------------------------
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};
const kToClock = (k, open = 570) => {
  const m = open + k;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date >= FIRST_DATE && d.date <= LAST_DATE,
);

function loadDailyMap(path) {
  const m = new Map();
  for (const b of JSON.parse(readFileSync(path, 'utf8'))) {
    m.set(new Date(Date.parse(b.t) + 12 * 3600_000).toISOString().slice(0, 10), b);
  }
  return m;
}

// --- financing: trailing 21-session mean of BIL's adjusted daily return, known before the day ---
const finRate = new Map(); // date -> annual rate (BIL yield + 2%)
{
  const bil = [...loadDailyMap(`${dataDir}/daily/BIL.json`).entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  );
  const rets = [];
  for (let i = 0; i < bil.length; i++) {
    const w = rets.slice(-21);
    const y = w.length ? Math.max(0, (w.reduce((a, b) => a + b, 0) / w.length) * 252) : 0;
    finRate.set(bil[i][0], y + FIN_SPREAD);
    if (i > 0) rets.push(bil[i][1].c / bil[i - 1][1].c - 1);
  }
}

// --- loading -----------------------------------------------------------------------------------
const counts = {};
const bump = (t, key) => {
  counts[t] ??= {};
  counts[t][key] = (counts[t][key] ?? 0) + 1;
};

function loadSession(ticker, day, raw) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const bars = JSON.parse(readFileSync(path, 'utf8'));
  if (!bars.length) return null;
  const midnight = nyMidnight(day.date);
  const open = hhmm(day.open);
  const n = hhmm(day.close) - open;
  const O = new Float64Array(n).fill(NaN);
  const H = new Float64Array(n).fill(NaN);
  const L = new Float64Array(n).fill(NaN);
  const C = new Float64Array(n).fill(NaN);
  let nb = 0;
  for (const b of bars) {
    const k = (Date.parse(b.t) - midnight) / 60_000 - open;
    if (k >= 0 && k < n) {
      O[k] = b.o;
      H[k] = b.h;
      L[k] = b.l;
      C[k] = b.c;
      nb++;
    }
  }
  if (!nb) return null;
  let lastC = NaN;
  for (let k = n - 1; k >= 0; k--)
    if (!Number.isNaN(C[k])) {
      lastC = C[k];
      break;
    }
  const d = raw.get(day.date);
  return {
    date: day.date,
    year: day.date.slice(0, 4),
    open,
    n,
    O,
    H,
    L,
    C,
    lastC,
    offOpen: d ? d.o : NaN,
    offClose: d ? d.c : NaN,
  };
}

// --- one trade ---------------------------------------------------------------------------------
/**
 * cfg: { or: minutes, target: R multiple or null, stop: bool, delay: minutes after the range
 *        ends, openSrc: 'official' | 'bar' }
 * returns { skip } or { side, entry, exit, R, gross, f, exitType, entryK, exitK }
 */
function simulate(s, cfg, log) {
  const N = cfg.or;
  let candleOpen;
  if (cfg.openSrc === 'official' && !Number.isNaN(s.offOpen)) candleOpen = s.offOpen;
  else {
    if (cfg.openSrc === 'official') log?.('no official open, using 09:30 bar open');
    if (Number.isNaN(s.O[0])) return { skip: 'no 09:30 bar' };
    candleOpen = s.O[0];
  }
  let hi = -Infinity,
    lo = Infinity,
    cl = NaN;
  for (let k = 0; k < N && k < s.n; k++) {
    if (Number.isNaN(s.O[k])) continue;
    hi = Math.max(hi, s.H[k]);
    lo = Math.min(lo, s.L[k]);
    cl = s.C[k];
  }
  if (Number.isNaN(cl)) return { skip: 'no bar in range' };
  const dc = Math.round(cl * 100) - Math.round(candleOpen * 100);
  if (dc === 0) return { skip: 'doji' };
  const side = dc > 0 ? 1 : -1;
  let entryK = -1;
  for (let k = N + cfg.delay; k < s.n && k - (N + cfg.delay) <= MAX_WAIT; k++)
    if (!Number.isNaN(s.O[k])) {
      entryK = k;
      break;
    }
  if (entryK < 0) return { skip: 'no entry bar' };
  const entry = s.O[entryK];
  const stop = side > 0 ? lo : hi;
  const R = side * (entry - stop);
  log?.(
    `range ${kToClock(0)}–${kToClock(N - 1)}: open ${candleOpen} (${cfg.openSrc}) high ${hi} low ${lo} close ${cl} → ${side > 0 ? 'LONG' : 'SHORT'}; entry ${kToClock(entryK)} open ${entry}, stop ${stop}, R ${R.toFixed(4)}`,
  );
  if (R <= 0) return { skip: 'entry beyond stop' };
  const target = cfg.target == null ? NaN : entry + side * cfg.target * R;
  if (cfg.target != null) log?.(`target ${target.toFixed(4)}`);
  let exit = NaN,
    exitType = 'close',
    exitK = s.n;
  for (let k = entryK; k < s.n; k++) {
    if (Number.isNaN(s.O[k])) continue;
    const o = s.O[k];
    if (cfg.stop) {
      const hit = side > 0 ? s.L[k] <= stop : s.H[k] >= stop;
      if (hit) {
        exit = side > 0 ? Math.min(stop, o) : Math.max(stop, o);
        exitType = 'stop';
        exitK = k;
        break;
      }
    }
    if (cfg.target != null) {
      const hit = side > 0 ? s.H[k] > target : s.L[k] < target;
      if (hit) {
        exit = side > 0 ? Math.max(target, o) : Math.min(target, o);
        exitType = 'target';
        exitK = k;
        break;
      }
    }
  }
  if (exitType === 'close') {
    if (!Number.isNaN(s.offClose)) exit = s.offClose;
    else {
      exit = s.lastC;
      exitType = 'close(last bar)';
    }
  }
  log?.(`exit ${exitType} at ${exitK < s.n ? kToClock(exitK) : 'close'}: ${exit}`);
  const gross = side * (exit / entry - 1);
  const f = Math.min((RISK * entry) / R, MAX_LEV);
  return { side, entry, exit, R, gross, f, exitType, entryK, exitK, Rreal: (side * (exit - entry)) / R };
}

// --- configs -----------------------------------------------------------------------------------
const P = { or: 5, target: 10, stop: true, delay: 0, openSrc: 'official' };
const CONFIGS = [
  ['P  OR5 10R', P],
  ['2  OR5 10R entry +1m', { ...P, delay: 1 }],
  ['3  OR5 2R', { ...P, target: 2 }],
  ['4  OR5 no target', { ...P, target: null }],
  ['5  OR15 10R', { ...P, or: 15 }],
  ['6  OR15 2R', { ...P, or: 15, target: 2 }],
  ['7  OR15 no target', { ...P, or: 15, target: null }],
  ['8  OR30 10R', { ...P, or: 30 }],
  ['9  OR30 2R', { ...P, or: 30, target: 2 }],
  ['10 OR30 no target', { ...P, or: 30, target: null }],
  ['11 OR5 no stop', { ...P, target: null, stop: false }],
  ['12 OR15 no stop', { ...P, or: 15, target: null, stop: false }],
  ['13 OR30 no stop', { ...P, or: 30, target: null, stop: false }],
  ['14 OR5 10R bar open', { ...P, openSrc: 'bar' }],
];

// --- statistics --------------------------------------------------------------------------------
const inSample = (date, smp) =>
  smp === 'A' ? date <= A_END : smp === 'B' ? date >= B_START : true;

/** days: [{date, year, t (trade or null)}]; returns stats for a sizing/cost/sample/side filter. */
function stats(days, { cost, sample = 'all', sizing = '1x', side = 0, year = null }) {
  const r = [];
  const trades = [];
  for (const d of days) {
    if (!inSample(d.date, sample) || (year && d.year !== year)) continue;
    const t = d.t;
    let x = 0;
    if (t && (!side || t.side === side)) {
      const net1 = t.gross - 2 * cost;
      if (sizing === '1x') x = net1;
      else x = t.f * net1 - (Math.max(t.f - 1, 0) * (finRate.get(d.date) ?? FIN_SPREAD)) / 252;
      trades.push({ ...t, net1 });
    }
    r.push(x);
  }
  return summarize(r, trades);
}

function summarize(r, trades) {
  const n = r.length;
  if (!n) return null;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let eq = 1,
    peak = 1,
    mdd = 0;
  for (const x of r) {
    eq *= 1 + x;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  const years = n / 252;
  const cagr = eq > 0 ? eq ** (1 / years) - 1 : -1;
  const sorted = [...r].sort((a, b) => b - a);
  const rest = sorted.slice(5);
  const mean5 = rest.reduce((a, b) => a + b, 0) / rest.length;
  const sd5 = Math.sqrt(rest.reduce((a, b) => a + (b - mean5) ** 2, 0) / (rest.length - 1));
  const nt = trades.length;
  return {
    n,
    mean,
    sd,
    t: mean / (sd / Math.sqrt(n)),
    sharpe: (mean / sd) * Math.sqrt(252),
    cagr,
    total: eq - 1,
    mdd,
    worst: sorted.at(-1),
    t5: mean5 / (sd5 / Math.sqrt(rest.length)),
    mean5,
    trades: nt,
    perYear: nt / years,
    hit: nt ? trades.filter((x) => x.net1 > 0).length / nt : NaN,
    avgTrade: nt ? trades.reduce((a, x) => a + x.net1, 0) / nt : NaN,
    avgR: nt ? trades.reduce((a, x) => a + x.Rreal, 0) / nt : NaN,
    avgF: nt ? trades.reduce((a, x) => a + x.f, 0) / nt : NaN,
    capped: nt ? trades.filter((x) => x.f >= MAX_LEV).length / nt : NaN,
    exits: trades.reduce((m, x) => ((m[x.exitType] = (m[x.exitType] ?? 0) + 1), m), {}),
  };
}

const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const bp = (x, d = 1) => (Number.isFinite(x) ? `${(x * 1e4).toFixed(d)}` : '—');
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pad = (s, w) => String(s).padStart(w);
const row = (cells, widths) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[0]) : pad(c, widths[i]))).join(' ');

// --- main --------------------------------------------------------------------------------------
const rawDaily = Object.fromEntries(TICKERS.map((t) => [t, loadDailyMap(`${dataDir}/daily-raw/${t}.json`)]));

if (CHECK) {
  const day = calendar.find((d) => d.date === CHECK.date);
  const s = loadSession(CHECK.ticker, day, rawDaily[CHECK.ticker]);
  console.log(`${CHECK.ticker} ${CHECK.date} session ${day.open}–${day.close}`);
  console.log(`official open ${s.offOpen} close ${s.offClose}; last regular bar close ${s.lastC}`);
  for (let k = 0; k < 12; k++) console.log(`  ${kToClock(k)} o ${s.O[k]} h ${s.H[k]} l ${s.L[k]} c ${s.C[k]}`);
  for (const [name, cfg] of [CONFIGS[0], CONFIGS[1], CONFIGS[13]]) {
    console.log(`\n[${name}]`);
    const t = simulate(s, cfg, (m) => console.log('  ' + m));
    if (t.skip) console.log('  skip: ' + t.skip);
    else {
      const k = t.exitK;
      if (k < s.n) console.log(`  exit bar ${kToClock(k)} o ${s.O[k]} h ${s.H[k]} l ${s.L[k]} c ${s.C[k]}`);
      console.log(
        `  gross ${bp(t.gross, 2)} bp, R realised ${f2(t.Rreal)}, paper fraction f ${f2(t.f)}, net 1bp ${bp(t.gross - 2e-4, 2)} bp`,
      );
    }
  }
  // highest high / lowest low after entry, for a hand check of "no stop/target hit"
  const t = simulate(s, P);
  if (!t.skip) {
    let hi = -Infinity, lo = Infinity, hiK = -1, loK = -1;
    for (let k = t.entryK; k < s.n; k++) {
      if (s.H[k] > hi) (hi = s.H[k]), (hiK = k);
      if (s.L[k] < lo) (lo = s.L[k]), (loK = k);
    }
    console.log(`\nafter entry: high ${hi} at ${kToClock(hiK)}, low ${lo} at ${kToClock(loK)}`);
  }
  process.exit(0);
}

const sessions = {};
for (const t of TICKERS) {
  sessions[t] = [];
  for (const day of calendar) {
    const s = loadSession(t, day, rawDaily[t]);
    if (!s) {
      bump(t, 'no minute file / empty');
      continue;
    }
    if (Number.isNaN(s.offOpen)) bump(t, 'no daily-raw bar (official open/close)');
    if (day.close !== '16:00') bump(t, 'early-close sessions');
    sessions[t].push(s);
  }
}

// run all configs
const results = {}; // results[cfgName][ticker] = [{date, year, t}]
const skips = {};
for (const [name, cfg] of CONFIGS) {
  results[name] = {};
  skips[name] = {};
  for (const tk of TICKERS) {
    const days = [];
    skips[name][tk] = {};
    for (const s of sessions[tk]) {
      const t = simulate(s, cfg);
      if (t.skip) {
        skips[name][tk][t.skip] = (skips[name][tk][t.skip] ?? 0) + 1;
        days.push({ date: s.date, year: s.year, t: null });
      } else days.push({ date: s.date, year: s.year, t });
    }
    results[name][tk] = days;
  }
}

console.log('H11 — 5-minute ORB in shares (Zarattini, Barbon & Aziz 2023)');
console.log(`data ${FIRST_DATE} → ${LAST_DATE}; A ≤ ${A_END}, B ≥ ${B_START}\n`);
console.log('== Data ==');
for (const t of TICKERS) {
  const ss = sessions[t];
  const nA = ss.filter((s) => s.date <= A_END).length;
  console.log(`${t}: ${ss.length} sessions (A ${nA}, B ${ss.length - nA}), ${ss[0].date} → ${ss.at(-1).date}`, counts[t]);
}
for (const [name] of [CONFIGS[0], CONFIGS[1], CONFIGS[13]]) console.log(`skips [${name}]`, JSON.stringify(skips[name]));

// direction disagreement official open vs 09:30 bar open
for (const t of TICKERS) {
  const a = results['P  OR5 10R'][t];
  const b = results['14 OR5 10R bar open'][t];
  let diff = 0, onlyOne = 0, gap5 = 0, both = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i].t, y = b[i].t;
    if (x && y) {
      both++;
      if (x.side !== y.side) diff++;
    } else if (x || y) onlyOne++;
  }
  for (const s of sessions[t]) if (!Number.isNaN(s.offOpen) && Math.abs(s.O[0] / s.offOpen - 1) > 5e-4) gap5++;
  console.log(
    `${t}: 09:30 bar open vs official open > 5 bp on ${gap5} days; P vs config 14: opposite direction on ${diff} of ${both} days, trade in only one on ${onlyOne}`,
  );
}

// --- replication gate -------------------------------------------------------------------------
console.log('\n== Replication gate: A, QQQ, P, paper sizing (1% risk, ≤4×, financing BIL+2%) ==');
for (const [cn, c] of Object.entries(COSTS)) {
  const x = stats(results['P  OR5 10R'].QQQ, { cost: c, sample: 'A', sizing: 'paper' });
  console.log(
    `${cn.padEnd(8)} CAGR ${pct(x.cagr)} total ${pct(x.total, 0)} Sharpe ${f2(x.sharpe)} t ${f2(x.t)} maxDD ${pct(x.mdd)} avg f ${f2(x.avgF)} capped ${pct(x.capped, 0)}`,
  );
}
{
  // paper-sizing without the financing charge, for comparison
  const days = results['P  OR5 10R'].QQQ.filter((d) => d.date <= A_END);
  const r = days.map((d) => (d.t ? d.t.f * d.t.gross : 0));
  const x = summarize(r, []);
  console.log(`zero cost, no financing: CAGR ${pct(x.cagr)} total ${pct(x.total, 0)} Sharpe ${f2(x.sharpe)}`);
  const qd = rawDaily.QQQ;
  const a0 = qd.get('2016-01-04'), a1 = qd.get(A_END) ?? qd.get('2023-05-31');
  console.log(`QQQ buy-and-hold price return over A (raw closes, no dividends): ${pct(a1.c / a0.o - 1, 0)}`);
}

// --- primary table ----------------------------------------------------------------------------
const W = [14, 6, 5, 5, 7, 6, 6, 6, 8, 7, 7, 8, 9, 9];
const HDR = ['', 'trades', '/yr', 'hit', 'avg bp', 'avgR', 't', 'Sharpe', 'CAGR', 'maxDD', 'worst', 't w/o5', 'paperCAGR', 'paperDD'];
function table(cfgName, title, tickers = TICKERS, samples = ['A', 'B', 'all']) {
  console.log(`\n== ${title} ==`);
  console.log(row(HDR, W));
  for (const tk of tickers)
    for (const smp of samples)
      for (const [cn, c] of Object.entries(COSTS)) {
        const x = stats(results[cfgName][tk], { cost: c, sample: smp });
        const p = stats(results[cfgName][tk], { cost: c, sample: smp, sizing: 'paper' });
        console.log(
          row(
            [`${tk} ${smp} ${cn}`, x.trades, f2(x.perYear, 0), pct(x.hit, 0), bp(x.avgTrade), f2(x.avgR), f2(x.t), f2(x.sharpe), pct(x.cagr), pct(x.mdd), pct(x.worst), f2(x.t5), pct(p.cagr), pct(p.mdd)],
            W,
          ),
        );
      }
}
table('P  OR5 10R', 'Primary P (OR5 · 10R · stop · entry 09:35 · official open), 1× notional; paper sizing at right');
table('2  OR5 10R entry +1m', 'Config 2: P with entry at 09:36');

// exits and leverage
console.log('\n== P: exit types and paper leverage (primary cost) ==');
for (const tk of TICKERS)
  for (const smp of ['A', 'B']) {
    const x = stats(results['P  OR5 10R'][tk], { cost: 1e-4, sample: smp });
    console.log(`${tk} ${smp}: exits ${JSON.stringify(x.exits)}; avg paper f ${f2(x.avgF)}, capped at 4× ${pct(x.capped, 0)}`);
  }

// long vs short
console.log('\n== P, long vs short, primary 1 bp, 1× (trades, hit, avg bp, t on daily, Sharpe) ==');
for (const tk of TICKERS)
  for (const smp of ['A', 'B'])
    for (const [sn, sd] of [['long', 1], ['short', -1]]) {
      const x = stats(results['P  OR5 10R'][tk], { cost: 1e-4, sample: smp, side: sd });
      console.log(`${tk} ${smp} ${sn.padEnd(5)} ${pad(x.trades, 5)} ${pct(x.hit, 0)} ${pad(bp(x.avgTrade), 6)} bp  t ${f2(x.t)}  Sharpe ${f2(x.sharpe)}  zero-cost avg ${bp(stats(results['P  OR5 10R'][tk], { cost: 0, sample: smp, side: sd }).avgTrade)} bp`);
    }

// per year
console.log('\n== P per year: 1× return at 1 bp (zero-cost return) [paper sizing at 1 bp] ==');
const years = [...new Set(sessions.QQQ.map((s) => s.year))];
console.log(row(['year', ...TICKERS.map((t) => t)], [5, 34, 34, 34]));
for (const y of years) {
  const cells = TICKERS.map((tk) => {
    const a = stats(results['P  OR5 10R'][tk], { cost: 1e-4, year: y });
    const z = stats(results['P  OR5 10R'][tk], { cost: 0, year: y });
    const p = stats(results['P  OR5 10R'][tk], { cost: 1e-4, year: y, sizing: 'paper' });
    return `${pct(a.total)} (${pct(z.total)}) [${pct(p.total, 0)}] n${a.trades}`;
  });
  console.log(row([y, ...cells], [5, 34, 34, 34]));
}

// pooled
console.log('\n== P pooled (equal thirds), 1×, t across dates ==');
for (const smp of ['A', 'B', 'all'])
  for (const [cn, c] of Object.entries(COSTS)) {
    const byDate = new Map();
    for (const tk of TICKERS)
      for (const d of results['P  OR5 10R'][tk]) {
        if (!inSample(d.date, smp)) continue;
        const v = d.t ? d.t.gross - 2 * c : 0;
        byDate.set(d.date, (byDate.get(d.date) ?? 0) + v / TICKERS.length);
      }
    const x = summarize([...byDate.values()], []);
    console.log(`${smp.padEnd(3)} ${cn.padEnd(8)} mean ${bp(x.mean, 2)} bp/day t ${f2(x.t)} Sharpe ${f2(x.sharpe)} CAGR ${pct(x.cagr)} maxDD ${pct(x.mdd)}`);
  }

// grid
console.log('\n== Grid (14 configs), 1×: avg trade bp at 1 bp / t on daily / Sharpe; zero-cost avg bp in brackets ==');
const GW = [24, 26, 26, 26, 26, 26, 26];
console.log(row(['config', 'QQQ A', 'QQQ B', 'SPY A', 'SPY B', 'IWM A', 'IWM B'], GW));
for (const [name] of CONFIGS) {
  const cells = [];
  for (const tk of TICKERS)
    for (const smp of ['A', 'B']) {
      const x = stats(results[name][tk], { cost: 1e-4, sample: smp });
      const z = stats(results[name][tk], { cost: 0, sample: smp });
      cells.push(`${bp(x.avgTrade)} / ${f2(x.t)} / ${f2(x.sharpe)} (${bp(z.avgTrade)})`);
    }
  console.log(row([name, ...cells], GW));
}
console.log('\nGrid at 3 bp (avg trade bp / t):');
for (const [name] of CONFIGS) {
  const cells = [];
  for (const tk of TICKERS)
    for (const smp of ['A', 'B']) {
      const x = stats(results[name][tk], { cost: 3e-4, sample: smp });
      cells.push(`${bp(x.avgTrade)} / ${f2(x.t)}`);
    }
  console.log(row([name, ...cells], [24, 16, 16, 16, 16, 16, 16]));
}
console.log('\nGrid, paper sizing at 1 bp: CAGR (Sharpe):');
for (const [name] of CONFIGS) {
  const cells = [];
  for (const tk of TICKERS)
    for (const smp of ['A', 'B']) {
      const x = stats(results[name][tk], { cost: 1e-4, sample: smp, sizing: 'paper' });
      cells.push(`${pct(x.cagr)} (${f2(x.sharpe)})`);
    }
  console.log(row([name, ...cells], [24, 16, 16, 16, 16, 16, 16]));
}

// cost break-even for P
console.log('\n== Break-even cost per side (mean daily 1× return = 0), P ==');
for (const tk of TICKERS)
  for (const smp of ['A', 'B']) {
    const tr = results['P  OR5 10R'][tk].filter((d) => d.t && inSample(d.date, smp));
    const g = tr.reduce((a, d) => a + d.t.gross, 0) / tr.length;
    console.log(`${tk} ${smp}: gross avg ${bp(g, 2)} bp/trade → break-even ${bp(g / 2, 2)} bp per side`);
  }

// pass rule
console.log('\n== Pass rule ==');
const gate = stats(results['P  OR5 10R'].QQQ, { cost: 0, sample: 'A', sizing: 'paper' });
console.log(`Gate: A QQQ paper sizing zero cost CAGR ${pct(gate.cagr)} (≥25%), t ${f2(gate.t)} (≥2.5): ${gate.cagr >= 0.25 && gate.t >= 2.5 ? 'PASS' : 'FAIL'}`);
const q = stats(results['P  OR5 10R'].QQQ, { cost: 1e-4, sample: 'B' });
const q2 = stats(results['2  OR5 10R entry +1m'].QQQ, { cost: 1e-4, sample: 'B' });
const sp = stats(results['P  OR5 10R'].SPY, { cost: 1e-4, sample: 'B' });
const c1 = q.mean > 0 && q.t >= 2;
const c2 = q2.mean > 0;
const c3 = sp.mean > 0;
console.log(`1. QQQ B P 1bp: mean ${bp(q.mean, 2)} bp/day, t ${f2(q.t)}, Sharpe ${f2(q.sharpe)}, n ${q.n} days (t≥2 needs Sharpe ≥ ${f2((2 * Math.sqrt(252)) / Math.sqrt(q.n))}): ${c1 ? 'pass' : 'fail'}`);
console.log(`2. QQQ B entry 09:36 1bp: mean ${bp(q2.mean, 2)} bp/day, t ${f2(q2.t)}: ${c2 ? 'pass' : 'fail'}`);
console.log(`3. SPY B P 1bp: mean ${bp(sp.mean, 2)} bp/day, t ${f2(sp.t)}: ${c3 ? 'pass' : 'fail'}`);
const verdict = c1 && c2 && c3 ? 'PASS' : q.mean <= 0 || q2.mean <= 0 ? 'FAIL' : 'INCONCLUSIVE';
console.log(`Verdict: ${verdict}`);

// --- diagnostics (added after the first run, information only; not configs) -------------------
if (args.includes('--diag')) {
  console.log('\n== DIAGNOSTICS (post hoc, information only) ==');
  const paperNoFin = (days, from, to, cost = 0) => {
    const r = days.filter((d) => d.date >= from && d.date <= to).map((d) => (d.t ? d.t.f * (d.t.gross - 2 * cost) : 0));
    return summarize(r, []);
  };
  const qP = results['P  OR5 10R'].QQQ;
  for (const [from, to] of [
    ['2016-01-04', '2023-05-31'],
    ['2016-01-04', '2023-02-17'],
    ['2016-01-04', '2022-12-30'],
  ]) {
    const x = paperNoFin(qP, from, to);
    console.log(`QQQ P paper sizing, zero cost, no financing, ${from} → ${to}: total ${pct(x.total, 0)} CAGR ${pct(x.cagr)} Sharpe ${f2(x.sharpe)} t ${f2(x.t)} maxDD ${pct(x.mdd)}`);
  }
  for (const tk of TICKERS)
    for (const [smp, from, to] of [['A', '2016-01-04', A_END], ['B', B_START, LAST_DATE]])
      for (const c of [0, 1e-4]) {
        const x = paperNoFin(results['P  OR5 10R'][tk], from, to, c);
        console.log(`${tk} ${smp} P paper sizing, NO financing, ${c ? '1 bp' : 'zero'}: CAGR ${pct(x.cagr)} Sharpe ${f2(x.sharpe)} maxDD ${pct(x.mdd)}`);
      }
  console.log('QQQ P paper sizing, zero cost, no financing, per year:');
  for (const y of years) {
    const x = paperNoFin(qP.filter((d) => d.year === y), '0', '9');
    const u = stats(qP, { cost: 0, year: y });
    console.log(`  ${y}: ${pct(x.total)}  (1× zero cost ${pct(u.total)}, avg trade ${bp(u.avgTrade)} bp, hit ${pct(u.hit, 0)})`);
  }
  // timing sensitivity: deliberate leaks / delays of the entry relative to the candle
  const variants = [
    ['LEAK: candle close = 09:35 bar close, entry 09:35 open', (s) => leakSim(s, 1)],
    ['LEAK: candle close = 09:36 bar close, entry 09:35 open', (s) => leakSim(s, 2)],
    ['entry 09:37 (delay 2)', (s) => simulate(s, { ...P, delay: 2 })],
    ['entry 09:40 (delay 5)', (s) => simulate(s, { ...P, delay: 5 })],
  ];
  function leakSim(s, extra) {
    // decide on a longer candle (k = 0 … 4+extra) but keep the 5-minute range's stop and enter at 09:35
    const t5 = simulate(s, P);
    let cl = NaN;
    for (let k = 0; k < 5 + extra; k++) if (!Number.isNaN(s.O[k])) cl = s.C[k];
    const dc = Math.round(cl * 100) - Math.round(s.offOpen * 100);
    if (t5.skip || !dc) return { skip: 'x' };
    const side = dc > 0 ? 1 : -1;
    if (side === t5.side) return t5;
    // flipped direction: rerun with that side forced (stop at the other extreme)
    return simulate({ ...s, offOpen: side > 0 ? -Infinity : Infinity }, P);
  }
  for (const [name, fn] of variants) {
    for (const tk of ['QQQ', 'SPY']) {
      const days = sessions[tk].map((s) => {
        const t = fn(s);
        return { date: s.date, year: s.year, t: t.skip ? null : t };
      });
      const a = stats(days, { cost: 0, sample: 'A' });
      const b = stats(days, { cost: 0, sample: 'B' });
      const pa = paperNoFin(days, '2016-01-04', A_END);
      console.log(`${name.padEnd(56)} ${tk}: zero-cost avg A ${bp(a.avgTrade)} bp (t ${f2(a.t)}), B ${bp(b.avgTrade)} bp (t ${f2(b.t)}); A paper no-fin CAGR ${pct(pa.cagr)}`);
    }
  }
  // gross per-trade by exit type, QQQ P
  for (const smp of ['A', 'B']) {
    const tr = qP.filter((d) => d.t && inSample(d.date, smp)).map((d) => d.t);
    const by = {};
    for (const t of tr) (by[t.exitType] ??= []).push(t.gross);
    console.log(`QQQ ${smp} gross by exit: ${Object.entries(by).map(([k, v]) => `${k} n${v.length} avg ${bp(v.reduce((a, b) => a + b, 0) / v.length)} bp, sum ${pct(v.reduce((a, b) => a + b, 0), 0)}`).join('; ')}`);
  }
  // sample dates for hand checks
  const pick = (type) => qP.filter((d) => d.t && d.t.exitType === type && d.date >= B_START).slice(0, 2).map((d) => d.date);
  console.log(`QQQ B sample dates: target ${pick('target')}, close ${pick('close')}`);
}
