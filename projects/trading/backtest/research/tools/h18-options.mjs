// H18: the H17 pre-market box signal (config P) expressed in QQQ options at real NBBO quotes.
// Design and pass rule: research/hypotheses/h18.md (pre-registered before this ran).
//
// usage:
//   node research/tools/h18-options.mjs <data dir> [--holdout]
//   node research/tools/h18-options.mjs <data dir> --check 2025-03-04 [config id]
// The signal code (loadTicker, simulate) is copied from h17-premarket-box.mjs; the only changes are
// cfg.noStop and the extra fields simulate returns.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK = checkIdx >= 0 ? { date: args[checkIdx + 1], cfg: args[checkIdx + 2] ?? 'A' } : null;
const HOLDOUT = args.includes('--holdout');
const WARM_FROM = '2015-12-01';
const FIRST_DATE = '2024-02-01';
const DEV_END = '2026-04-30';
const LAST_DATE = '2026-11-13';
const NQ_PER_QQQ = 41;
const FEE = 0.05;
const COSTS = { primary: 0, stress: 0.01, harsh: 0.02 };

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date >= WARM_FROM && d.date <= LAST_DATE,
);

// --- loading: one day as minute-of-day arrays, plus the EMA states completed that day ----------
function makeEma(n) {
  const a = 2 / (n + 1);
  let v = NaN;
  return (x) => (v = Number.isNaN(v) ? x : v + a * (x - v));
}

function loadTicker(ticker) {
  const emaAll = [makeEma(50), makeEma(200)];
  const emaRth = [makeEma(50), makeEma(200)];
  const days = [];
  for (const day of calendar) {
    const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
    if (!existsSync(path)) continue;
    const bars = JSON.parse(readFileSync(path, 'utf8'));
    if (!bars.length) continue;
    const midnight = nyMidnight(day.date);
    const O = new Float64Array(1440).fill(NaN);
    const H = new Float64Array(1440).fill(NaN);
    const L = new Float64Array(1440).fill(NaN);
    const C = new Float64Array(1440).fill(NaN);
    for (const b of bars) {
      const m = (Date.parse(b.t) - midnight) / 60_000;
      if (m >= 0 && m < 1440 && b.v > 0) {
        O[m] = b.o;
        H[m] = b.h;
        L[m] = b.l;
        C[m] = b.c;
      }
    }
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    // 15-minute buckets; state recorded at each bucket's end minute
    const all = [];
    const rth = [];
    for (let s = 240; s < 1200; s += 15) {
      let c = NaN;
      for (let m = s; m < s + 15; m++) if (!Number.isNaN(C[m])) c = C[m];
      if (Number.isNaN(c)) continue;
      all.push([s + 15, emaAll[0](c), emaAll[1](c)]);
      if (s >= open && s + 15 <= close) rth.push([s + 15, emaRth[0](c), emaRth[1](c)]);
    }
    days.push({ date: day.date, open, close, O, H, L, C, all, rth });
  }
  // EMA state at minute T of day i: last record at or before T, else the previous day's last.
  const stateAt = (i, T, which) => {
    for (let j = i; j >= 0; j--) {
      const recs = days[j][which];
      for (let k = recs.length - 1; k >= 0; k--) if (j < i || recs[k][0] <= T) return recs[k];
    }
    return null;
  };
  return { days, stateAt };
}

// --- one ticker-day ----------------------------------------------------------------------------
function simulate(t, i, cfg, log) {
  const d = t.days[i];
  let hi = -Infinity;
  let lo = Infinity;
  let nBox = 0;
  for (let m = 540; m < 570; m++) {
    if (Number.isNaN(d.H[m])) continue;
    nBox++;
    hi = Math.max(hi, d.H[m]);
    lo = Math.min(lo, d.L[m]);
  }
  if (nBox < 20) return { skip: 'thin box' };
  log?.(`box 09:00–09:30 from ${nBox} bars: ${lo} – ${hi}`);

  let side = 0;
  let brkEnd = -1;
  for (let s = d.open; s <= d.open + 55; s += 5) {
    let c = NaN;
    for (let m = s; m < s + 5; m++) if (!Number.isNaN(d.C[m])) c = d.C[m];
    if (Number.isNaN(c)) continue;
    if (c > hi) side = 1;
    else if (c < lo) side = -1;
    if (side) {
      brkEnd = s + 5;
      log?.(`breakout: 5-min bar ${clock(s)} closed ${c} → ${side > 0 ? 'long' : 'short'}`);
      break;
    }
  }
  if (!side) return { skip: 'no breakout' };

  if (cfg.filter) {
    const st = t.stateAt(i, brkEnd, cfg.filter);
    if (!st) return { skip: 'no ema' };
    log?.(`EMA50 ${st[1].toFixed(3)} EMA200 ${st[2].toFixed(3)} as of ${clock(st[0])}`);
    if ((st[1] > st[2] ? 1 : -1) !== side) return { skip: 'filter' };
  }

  let em = -1;
  const from = brkEnd + (cfg.delay ?? 0);
  for (let m = from; m < from + 5; m++)
    if (!Number.isNaN(d.O[m])) {
      em = m;
      break;
    }
  if (em < 0) return { skip: 'no entry bar' };
  const entry = d.O[em];
  const stop = side > 0 ? lo : hi;
  const risk = side * (entry - stop);
  if (risk <= 0) return { skip: 'entry beyond stop' };
  const target = cfg.target ? entry + side * cfg.target * risk : NaN;
  const flat = Math.min(cfg.flat, d.close - 5);
  log?.(`entry ${clock(em)} @ ${entry}, stop ${stop}, target ${target}, R ${risk.toFixed(3)}`);

  let exit = NaN;
  let how = '';
  let xm = -1;
  for (let m = em; m < flat; m++) {
    if (Number.isNaN(d.O[m])) continue;
    const o = d.O[m];
    if (!cfg.noStop && side * (o - stop) <= 0) [exit, how] = [o, 'stop gap'];
    else if (cfg.target && side * (o - target) >= 0) [exit, how] = [target, 'target'];
    else if (!cfg.noStop && (side > 0 ? d.L[m] : -d.H[m]) <= side * stop) [exit, how] = [stop, 'stop'];
    else if (cfg.target && (side > 0 ? d.H[m] : -d.L[m]) >= side * target) [exit, how] = [target, 'target'];
    if (how) {
      xm = m;
      break;
    }
  }
  if (!how) {
    for (let m = flat; m < d.close && Number.isNaN(exit); m++) if (!Number.isNaN(d.O[m])) [exit, xm] = [d.O[m], m];
    for (let m = flat - 1; m > em && Number.isNaN(exit); m--) if (!Number.isNaN(d.C[m])) [exit, xm] = [d.C[m], m];
    how = 'flat';
  }
  log?.(`exit ${clock(xm)} @ ${exit} (${how})`);
  // The minute an option order goes out: a gap is seen at the bar's open, a touch only once the
  // bar has ended, and flat at the flat time.
  const om = how === 'flat' ? flat : how === 'stop gap' ? xm : xm + 1;
  return { side, entry, exit, risk, how, R: (side * (exit - entry)) / risk, em, om, stop, target };
}

// --- option quotes -----------------------------------------------------------------------------
/** `{ exps: ['250304', …], legs: Map('250304C490' → rows of [minute, bid, ask]) }` */
function loadQuotes(date) {
  const file = `${dataDir}/quotes/QQQ/${date}.json`;
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const midnight = nyMidnight(date);
  const legs = new Map();
  const strikes = new Map(); // '250304C' → sorted strikes
  for (const [sym, rows] of Object.entries(raw)) {
    if (!sym.startsWith('QQQ')) continue;
    const exp = sym.slice(3, 9);
    const type = sym[9];
    const k = Number(sym.slice(10)) / 1000;
    legs.set(`${exp}${type}${k}`, rows.map(([t, b, a]) => [(t - midnight) / 60_000, b, a]));
    const key = `${exp}${type}`;
    if (!strikes.has(key)) strikes.set(key, []);
    strikes.get(key).push(k);
  }
  for (const list of strikes.values()) list.sort((a, b) => a - b);
  const exps = [...new Set([...strikes.keys()].map((k) => k.slice(0, 6)))].sort();
  return { exps, legs, strikes };
}

function quoteAt(rows, m) {
  if (!rows) return undefined;
  let lo = 0;
  let hi = rows.length - 1;
  let found;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= m) {
      found = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found && found[2] > 0 && found[2] >= found[1] ? { bid: found[1], ask: found[2] } : undefined;
}

const CONFIGS = {
  A: { label: 'long ATM, 0DTE', legs: 'atm' },
  B: { label: 'long ATM, next expiration', legs: 'atm', next: true },
  C: { label: 'long ITM (strike at the stop), 0DTE', legs: 'itm' },
  D: { label: 'debit vertical ATM → target strike, 0DTE', legs: 'debit' },
  E: { label: 'credit vertical beyond the stop, $2 wide, 0DTE', legs: 'credit' },
  F: { label: 'A, ignoring the underlying stop (info)', legs: 'atm', noStop: true, info: true },
  G: { label: 'A, entry one minute late (info)', legs: 'atm', delay: 1, info: true },
};

/** The legs to trade, `[{ id, q: +1 long / −1 short, k }]`, or a skip reason. */
function chooseLegs(cfg, sig, q, date, m) {
  const today = date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
  const exp = cfg.next ? q.exps.find((e) => e > today) : q.exps.find((e) => e >= today);
  if (!exp) return 'no expiration';
  const dir = sig.side > 0 ? 'C' : 'P';
  const away = sig.side > 0 ? 'P' : 'C';
  const quoted = (type, k) => quoteAt(q.legs.get(`${exp}${type}${k}`), m) !== undefined;
  const nearest = (type, px) => {
    let best;
    for (const k of q.strikes.get(`${exp}${type}`) ?? [])
      if (quoted(type, k) && (best === undefined || Math.abs(k - px) < Math.abs(best - px))) best = k;
    return best;
  };
  let legs;
  if (cfg.legs === 'atm') legs = [{ type: dir, q: 1, k: nearest(dir, sig.entry) }];
  else if (cfg.legs === 'itm') legs = [{ type: dir, q: 1, k: nearest(dir, sig.stop) }];
  else if (cfg.legs === 'debit') {
    const a = nearest(dir, sig.entry);
    const b = nearest(dir, sig.target);
    if (a === b) return 'vertical collapsed';
    legs = [
      { type: dir, q: 1, k: a },
      { type: dir, q: -1, k: b },
    ];
  } else {
    const list = (q.strikes.get(`${exp}${away}`) ?? []).filter((k) => quoted(away, k));
    const short = sig.side > 0 ? list.filter((k) => k <= sig.stop).at(-1) : list.find((k) => k >= sig.stop);
    if (short === undefined) return 'no strike';
    const long = short - sig.side * 2;
    if (!list.includes(long)) return 'no wing';
    legs = [
      { type: away, q: -1, k: short },
      { type: away, q: 1, k: long },
    ];
  }
  if (legs.some((l) => l.k === undefined)) return 'no strike';
  if (legs.some((l) => Math.abs(l.k - sig.entry) > 10)) return 'strike > $10 away';
  return legs.map((l) => ({ ...l, id: `${exp}${l.type}${l.k}` }));
}

/** One trade at every cost level: `{ legs, byCost: { cost → { pnl, risk } } }` (dollars per lot). */
function priceTrade(cfg, sig, q, date) {
  const m0 = sig.em + (cfg.delay ?? 0);
  const legs = chooseLegs(cfg, sig, q, date, m0);
  if (typeof legs === 'string') return { skip: legs };
  const m1 = Math.max(sig.om, m0);
  const entryQ = legs.map((l) => quoteAt(q.legs.get(l.id), m0));
  const exitQ = legs.map((l) => quoteAt(q.legs.get(l.id), m1));
  if (exitQ.some((x) => !x)) return { skip: 'no exit quote' };
  const byCost = {};
  for (const [name, extra] of Object.entries(COSTS)) {
    const fill = (x, buy) => (buy ? x.ask + extra : Math.max(0, x.bid - extra));
    const open = legs.reduce((s, l, i) => s - l.q * fill(entryQ[i], l.q > 0), 0); // + = credit
    const close = legs.reduce((s, l, i) => s + l.q * fill(exitQ[i], l.q < 0), 0);
    const fees = FEE * 2 * legs.length;
    const pnl = 100 * (open + close) - fees;
    const width = legs.length === 2 ? Math.abs(legs[0].k - legs[1].k) : 0;
    const risk = (open < 0 ? -open : width - open) * 100 + fees;
    byCost[name] = { pnl, risk };
  }
  return { legs, entryQ, exitQ, m0, m1, byCost };
}

// --- run ---------------------------------------------------------------------------------------
const P = { filter: 'all', target: 3, flat: 955 };
const qqq = loadTicker('QQQ');
const inSample = (date) => (HOLDOUT ? date > DEV_END && date <= LAST_DATE : date >= FIRST_DATE && date <= DEV_END);
// Frozen after the development run (see h18.md); only these run on the holdout.
const FROZEN = ['B', 'A'];

if (CHECK) {
  const i = qqq.days.findIndex((d) => d.date === CHECK.date);
  const cfg = CONFIGS[CHECK.cfg];
  const sig = simulate(qqq, i, { ...P, noStop: cfg.noStop }, (s) => console.log(s));
  if (sig.skip) console.log(sig);
  else {
    const r = priceTrade(cfg, sig, loadQuotes(CHECK.date), CHECK.date);
    console.log(`option entry ${clock(r.m0)}, exit ${clock(r.m1)}`);
    r.legs?.forEach((l, k) => console.log(`  ${l.q > 0 ? 'buy ' : 'sell'} ${l.id}: entry ${JSON.stringify(r.entryQ[k])} exit ${JSON.stringify(r.exitQ[k])}`));
    console.log(r.byCost ?? r);
  }
  process.exit(0);
}

const out = [];
const log = (s = '') => {
  out.push(s);
  console.log(s);
};
const f = (x, d = 3) => (x >= 0 ? '+' : '') + x.toFixed(d);
function stats(xs) {
  const n = xs.length;
  if (!n) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const x of xs) {
    eq += x;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq - peak);
  }
  return { n, mean, t: (mean / sd) * Math.sqrt(n), win: xs.filter((x) => x > 0).length / n, dd };
}

log(`H18 ${HOLDOUT ? 'HOLDOUT 2026-05-01' : `development ${FIRST_DATE}`} → ${HOLDOUT ? LAST_DATE : DEV_END}, QQQ options at real NBBO`);
log('return on risk = P&L / max loss per trade (fees included); one trade per signal day');
log();

const quoteCache = new Map();
const quotesFor = (date) => {
  if (!quoteCache.has(date)) quoteCache.set(date, loadQuotes(date));
  return quoteCache.get(date);
};
const results = {};
for (const [id, cfg] of Object.entries(CONFIGS)) {
  if (HOLDOUT && !FROZEN.includes(id)) continue;
  const trades = [];
  const skips = {};
  qqq.days.forEach((d, i) => {
    if (!inSample(d.date)) return;
    const sig = simulate(qqq, i, { ...P, noStop: cfg.noStop });
    if (sig.skip) return;
    const q = quotesFor(d.date);
    if (!q) {
      skips['no quote file'] = (skips['no quote file'] ?? 0) + 1;
      return;
    }
    const r = priceTrade(cfg, sig, q, d.date);
    if (r.skip) skips[r.skip] = (skips[r.skip] ?? 0) + 1;
    else trades.push({ date: d.date, sig, ...r });
  });
  results[id] = trades;
  log(`== ${id}: ${cfg.label} ==  trades ${trades.length}, skipped ${JSON.stringify(skips)}`);
  const sharesR = stats(trades.map((t) => t.sig.R - 1 / NQ_PER_QQQ / t.sig.risk));
  log(`   same days as shares (H17, 1 NQ pt): mean ${f(sharesR.mean)}R  t ${f(sharesR.t, 2)}`);
  const avgRisk = trades.reduce((a, t) => a + t.byCost.primary.risk, 0) / trades.length;
  log(`   average max loss per lot $${avgRisk.toFixed(0)}`);
  for (const cost of Object.keys(COSTS)) {
    const ror = trades.map((t) => t.byCost[cost].pnl / t.byCost[cost].risk);
    const s = stats(ror);
    const usd = trades.reduce((a, t) => a + t.byCost[cost].pnl, 0) / trades.length;
    log(`   ${cost.padEnd(8)} return on risk ${f(s.mean)}  t ${f(s.t, 2).padStart(6)}  win ${(100 * s.win).toFixed(1)}%  $/lot ${f(usd, 1).padStart(7)}  maxDD ${s.dd.toFixed(1)} risk units`);
  }
  const years = [...new Set(trades.map((t) => t.date.slice(0, 4)))];
  log(`   per year (primary): ${years.map((y) => {
    const s = stats(trades.filter((t) => t.date.startsWith(y)).map((t) => t.byCost.primary.pnl / t.byCost.primary.risk));
    return `${y} ${f(s.mean)} (n ${s.n}, t ${f(s.t, 2)})`;
  }).join('; ')}`);
  const byHow = {};
  for (const t of trades) (byHow[t.sig.how] ??= []).push(t.byCost.primary.pnl / t.byCost.primary.risk);
  log(`   by exit: ${Object.entries(byHow).map(([h, xs]) => `${h} n ${xs.length} mean ${f(stats(xs).mean)}`).join('; ')}`);
  log();
}

log('== candidates (development rule: primary mean > 0, t ≥ 2.0, stress mean > 0; not F/G) ==');
const cands = [];
for (const [id, trades] of Object.entries(results)) {
  if (CONFIGS[id].info) continue;
  const p = stats(trades.map((t) => t.byCost.primary.pnl / t.byCost.primary.risk));
  const s = stats(trades.map((t) => t.byCost.stress.pnl / t.byCost.stress.risk));
  const ok = p.mean > 0 && p.t >= 2 && s.mean > 0;
  log(`${id}: primary ${f(p.mean)} t ${f(p.t, 2)}, stress ${f(s.mean)} → ${HOLDOUT ? (p.mean > 0 && s.mean > 0 ? 'holdout > 0 at primary and stress' : 'holdout FAIL') : ok ? 'candidate' : 'no'}`);
  if (ok) cands.push([id, p.t]);
}
if (!HOLDOUT) log(`candidates: ${cands.length ? cands.sort((a, b) => b[1] - a[1]).map((c) => c[0]).join(', ') : 'none'}`);
