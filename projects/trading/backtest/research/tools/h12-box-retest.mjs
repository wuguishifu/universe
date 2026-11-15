// H12: the first-candle box with a retest (retail "box method"), shares + 0DTE options (info).
// Design and pass rule: research/hypotheses/h12.md (pre-registered before this ran).
//
// usage:
//   node research/tools/h12-box-retest.mjs [data dir]                      full report
//   node research/tools/h12-box-retest.mjs [data dir] --check SPY 2025-03-04
//        prints the box, every 5-minute candle, the setup and the P / C-P trades for one
//        ticker-day, recomputed from the raw file by wall-clock time (slow path), next to the
//        fast-path result.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK = checkIdx >= 0 ? { ticker: args[checkIdx + 1], date: args[checkIdx + 2] } : null;
const FIRST_DATE = '2016-01-04';
const LAST_DATE = '2026-11-13';
const OPT_FROM = '2024-02-01';
const OPT_TO = '2026-04-30'; // options development only; the options holdout is NOT run
const TICKERS = ['SPY', 'QQQ', 'IWM'];
const COSTS = { zero: 0, primary: 1e-4, stress: 3e-4 };
const FULL_YEARS = ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];

// --- configs (h12.md "Grid") ---------------------------------------------------------------------
// box: minutes; stop: 'mid' | 'edge'; tgt: R multiple or null; N: retest window in candles;
// deadline / cutoff: minutes after the open by which the retest / breakout candle must END;
// delay: extra minutes before the entry fill; mode: 'retest' | 'control'.
const base = { box: 15, stop: 'mid', tgt: 2, N: 12, deadline: 150, cutoff: 120, delay: 0 };
const RETEST = [
  { id: 'P', ...base },
  { id: 'P+1min', ...base, delay: 1 },
  { id: 'box5', ...base, box: 5 },
  { id: 'box30', ...base, box: 30 },
  { id: 'stop-edge', ...base, stop: 'edge' },
  { id: 'tgt1R', ...base, tgt: 1 },
  { id: 'tgt3R', ...base, tgt: 3 },
  { id: 'no-tgt', ...base, tgt: null },
  { id: 'win30', ...base, N: 6 },
  { id: 'win120', ...base, N: 24, deadline: 240 },
].map((c) => ({ ...c, mode: 'retest' }));
const CONTROL = RETEST.filter((c) => !c.id.startsWith('win')).map((c) => ({
  ...c,
  id: `C-${c.id}`,
  mode: 'control',
}));
const CONFIGS = [...RETEST, ...CONTROL];

// --- time helpers ----------------------------------------------------------------------------------
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
const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date >= FIRST_DATE && d.date <= LAST_DATE,
);

// --- loading ---------------------------------------------------------------------------------------
/** One regular session; arrays indexed by k = minutes after the open, NaN where no bar starts. */
function loadSession(ticker, day) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw.length) return null;
  const midnight = nyMidnight(day.date);
  const open = hhmm(day.open);
  const n = hhmm(day.close) - open;
  const O = new Float64Array(n).fill(NaN);
  const H = new Float64Array(n).fill(NaN);
  const L = new Float64Array(n).fill(NaN);
  const C = new Float64Array(n).fill(NaN);
  for (const b of raw) {
    const k = (Date.parse(b.t) - midnight) / 60_000 - open;
    if (k >= 0 && k < n) {
      O[k] = b.o;
      H[k] = b.h;
      L[k] = b.l;
      C[k] = b.c;
    }
  }
  const Cff = new Float64Array(n).fill(NaN); // last close at or before k
  let c = NaN;
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(C[k])) c = C[k];
    Cff[k] = c;
  }
  return { ticker, date: day.date, year: day.date.slice(0, 4), open, n, midnight, O, H, L, C, Cff };
}

const counts = {};
const bump = (key) => (counts[key] = (counts[key] ?? 0) + 1);

// --- the rule ----------------------------------------------------------------------------------------
function boxOf(s, B) {
  let hi = -Infinity,
    lo = Infinity,
    nb = 0;
  for (let k = 0; k < B; k++) {
    if (Number.isNaN(s.H[k])) continue;
    hi = Math.max(hi, s.H[k]);
    lo = Math.min(lo, s.L[k]);
    nb++;
  }
  if (nb < (2 / 3) * B || !(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2 };
}

/** 5-minute candle starting at k0 (null if no bar in it). */
function candle(s, k0) {
  let h = -Infinity,
    l = Infinity,
    c = NaN;
  for (let k = k0; k < k0 + 5 && k < s.n; k++) {
    if (Number.isNaN(s.O[k])) continue;
    h = Math.max(h, s.H[k]);
    l = Math.min(l, s.L[k]);
    c = s.C[k];
  }
  return Number.isNaN(c) ? null : { k0, end: k0 + 5, h, l, c };
}

/**
 * The setup for one session under a config's box / window: the box, the breakout (first 5-minute
 * close outside the box ending by the cutoff) and what happened next: 'retest' | 'void' | 'expired'.
 */
function findSetup(s, cfg, trace) {
  const box = boxOf(s, cfg.box);
  if (!box) return { box: null };
  let bo = null;
  for (let i = 0; ; i++) {
    const k0 = cfg.box + 5 * i;
    if (k0 + 5 > cfg.cutoff) break;
    const cd = candle(s, k0);
    if (trace) trace.push({ ...cd, k0, note: 'pre' });
    if (!cd) continue;
    if (cd.c > box.hi) bo = { side: 1, i, cd };
    else if (cd.c < box.lo) bo = { side: -1, i, cd };
    if (bo) break;
  }
  if (!bo) return { box, bo: null };
  const edge = bo.side > 0 ? box.hi : box.lo;
  for (let j = bo.i + 1; j <= bo.i + cfg.N; j++) {
    const k0 = cfg.box + 5 * j;
    if (k0 + 5 > cfg.deadline) break;
    const cd = candle(s, k0);
    if (trace) trace.push({ ...cd, k0, note: 'post' });
    if (!cd) continue;
    const back = bo.side > 0 ? cd.c <= edge : cd.c >= edge;
    if (back) return { box, bo, outcome: 'void', at: cd };
    const touch = bo.side > 0 ? cd.l <= edge : cd.h >= edge;
    if (touch) return { box, bo, outcome: 'retest', at: cd };
  }
  return { box, bo, outcome: 'expired' };
}

function firstBarAtOrAfter(s, k, maxWait) {
  for (let j = k; j < s.n && j - k <= maxWait; j++) if (!Number.isNaN(s.O[j])) return j;
  return -1;
}

/** Simulate one share trade entered at the open of the first bar at or after k. */
function simTrade(s, k, side, box, cfg) {
  const e = firstBarAtOrAfter(s, k, 5);
  const exitK = s.n - 5;
  if (e < 0) return { skip: 'no entry bar within 5 min' };
  if (e >= exitK) return { skip: 'entry at/after the time exit' };
  const entry = s.O[e];
  const stop = cfg.stop === 'mid' ? box.mid : side > 0 ? box.lo : box.hi;
  const R = side * (entry - stop);
  if (!(R > 0)) return { skip: 'entry at/beyond the stop' };
  const target = cfg.tgt ? entry + side * cfg.tgt * R : NaN;
  for (let j = e; j < exitK; j++) {
    if (Number.isNaN(s.O[j])) continue;
    const hitStop = side > 0 ? s.L[j] <= stop : s.H[j] >= stop;
    const hitTgt = cfg.tgt && (side > 0 ? s.H[j] >= target : s.L[j] <= target);
    if (hitStop) {
      const px = side > 0 ? Math.min(stop, s.O[j]) : Math.max(stop, s.O[j]);
      return { e, entry, stop, target, R, exit: px, x: j, reason: 'stop' };
    }
    if (hitTgt) return { e, entry, stop, target, R, exit: target, x: j, reason: 'target' };
  }
  const xb = firstBarAtOrAfter(s, exitK, 5);
  if (xb < 0) {
    bump('time exit: no bar 15:55..16:00 (last regular close used)');
    return { e, entry, stop, target, R, exit: s.Cff[s.n - 1], x: s.n - 1, reason: 'time', timeK: exitK };
  }
  return { e, entry, stop, target, R, exit: s.O[xb], x: xb, reason: 'time', timeK: exitK };
}

function tradeFor(s, setup, cfg) {
  if (!setup.box || !setup.bo) return null;
  const side = setup.bo.side;
  let k;
  if (cfg.mode === 'retest') {
    if (setup.outcome !== 'retest') return null;
    k = setup.at.end + cfg.delay;
  } else k = setup.bo.cd.end + cfg.delay;
  const t = simTrade(s, k, side, setup.box, cfg);
  if (t.skip) {
    bump(`${cfg.id}: ${t.skip}`);
    return null;
  }
  return { ticker: s.ticker, date: s.date, year: s.year, side, group: setup.outcome, ...t };
}

// --- run all configs --------------------------------------------------------------------------------
const trades = Object.fromEntries(CONFIGS.map((c) => [c.id, []]));
const eligible = Object.fromEntries(CONFIGS.map((c) => [c.id, new Set()]));
const setupCounts = {}; // per retest config: breakouts and outcomes per ticker
const sessions = { SPY: new Map(), QQQ: new Map(), IWM: new Map() }; // only for the options pass
const nSessions = {};

function runAll() {
  for (const ticker of TICKERS) {
    nSessions[ticker] = 0;
    for (const day of calendar) {
      const s = loadSession(ticker, day);
      if (!s) {
        bump(`${ticker}: no data`);
        continue;
      }
      nSessions[ticker]++;
      const cache = new Map();
      for (const cfg of CONFIGS) {
        const key = `${cfg.box}|${cfg.N}|${cfg.deadline}|${cfg.cutoff}`;
        if (!cache.has(key)) cache.set(key, findSetup(s, cfg));
        const setup = cache.get(key);
        if (!setup.box) {
          if (cfg.id === 'P') bump(`${ticker}: box invalid (P)`);
          continue;
        }
        eligible[cfg.id].add(s.date);
        if (cfg.mode === 'retest') {
          const sc = (setupCounts[cfg.id] ??= {});
          const t = (sc[ticker] ??= { days: 0, breakouts: 0, retest: 0, void: 0, expired: 0 });
          t.days++;
          if (setup.bo) {
            t.breakouts++;
            t[setup.outcome]++;
          }
        }
        const tr = tradeFor(s, setup, cfg);
        if (tr) trades[cfg.id].push(tr);
      }
      if (s.date >= OPT_FROM && s.date <= OPT_TO) sessions[ticker].set(s.date, s);
    }
  }
}

// --- statistics ---------------------------------------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function tstat(a) {
  const n = a.length;
  if (n < 3) return NaN;
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1));
  return (m / sd) * Math.sqrt(n);
}
const netR = (t, c) => t.side * (t.exit / t.entry - 1) - 2 * c;
const netRm = (t, c) => (t.side * (t.exit - t.entry) - c * (t.entry + t.exit)) / t.R;
function dayClusterT(list, val) {
  const by = new Map();
  for (const t of list) {
    const a = by.get(t.date) ?? [];
    a.push(val(t));
    by.set(t.date, a);
  }
  return tstat([...by.values()].map(mean));
}
function evaluate(list, elig, c) {
  const n = list.length;
  const r = list.map((t) => netR(t, c));
  const dates = [...elig].sort();
  const daily = new Map(dates.map((d) => [d, 0]));
  for (let i = 0; i < n; i++) daily.set(list[i].date, (daily.get(list[i].date) ?? 0) + r[i] / 3);
  const dr = dates.map((d) => daily.get(d));
  const m = mean(dr);
  const sd = Math.sqrt(dr.reduce((x, y) => x + (y - m) ** 2, 0) / (dr.length - 1));
  let eq = 1,
    peak = 1,
    mdd = 0;
  for (const x of dr) {
    eq *= 1 + x;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  const years = dr.length / 252;
  const best5 = new Set(
    [...daily.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((e) => e[0]),
  );
  const w5 = list.filter((t) => !best5.has(t.date));
  return {
    n,
    perYear: n / years,
    hit: r.filter((x) => x > 0).length / n,
    avg: mean(r),
    avgR: mean(list.map((t) => netRm(t, c))),
    t: dayClusterT(list, (t) => netR(t, c)),
    sharpe: sd ? (m / sd) * Math.sqrt(252) : NaN,
    cagr: eq ** (1 / years) - 1,
    mdd,
    worst: Math.min(...dr),
    w5avg: mean(w5.map((t) => netR(t, c))),
    w5t: dayClusterT(w5, (t) => netR(t, c)),
    stop: list.filter((t) => t.reason === 'stop').length / n,
    target: list.filter((t) => t.reason === 'target').length / n,
    time: list.filter((t) => t.reason === 'time').length / n,
    riskBp: mean(list.map((t) => t.R / t.entry)),
  };
}
const yearSums = (list, c) => {
  const y = {};
  for (const t of list) y[t.year] = (y[t.year] ?? 0) + netR(t, c) / 3;
  return y;
};

const bp = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '—' : (x * 1e4).toFixed(d));
const pct = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const f2 = (x) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(2));
const pad = (s, w) => String(s).padStart(w);
const padE = (s, w) => String(s).padEnd(w);
const p = (...a) => console.log(...a);

const HDR =
  `${padE('', 22)}${pad('n', 6)}${pad('/yr', 6)}${pad('hit', 6)}${pad('avg0', 7)}${pad('avg1', 7)}${pad('t1', 7)}` +
  `${pad('avgR1', 7)}${pad('Sh1', 7)}${pad('CAGR1', 8)}${pad('mdd1', 8)}${pad('worst', 7)}${pad('w/o5', 7)}${pad('t', 6)}` +
  `${pad('avg3', 7)}${pad('t3', 7)}${pad('stop', 6)}${pad('tgt', 6)}${pad('time', 6)}${pad('R bp', 6)}`;
function row(label, list, elig) {
  if (!list.length) return `${padE(label, 22)}${pad(0, 6)}`;
  const z = evaluate(list, elig, COSTS.zero);
  const e = evaluate(list, elig, COSTS.primary);
  const s3 = evaluate(list, elig, COSTS.stress);
  return (
    `${padE(label, 22)}${pad(e.n, 6)}${pad(e.perYear.toFixed(0), 6)}${pad(pct(e.hit, 0), 6)}${pad(bp(z.avg), 7)}` +
    `${pad(bp(e.avg), 7)}${pad(f2(e.t), 7)}${pad(f2(e.avgR), 7)}${pad(f2(e.sharpe), 7)}${pad(pct(e.cagr), 8)}` +
    `${pad(pct(e.mdd), 8)}${pad(pct(e.worst, 2), 7)}${pad(bp(e.w5avg), 7)}${pad(f2(e.w5t), 6)}${pad(bp(s3.avg), 7)}` +
    `${pad(f2(s3.t), 7)}${pad(pct(e.stop, 0), 6)}${pad(pct(e.target, 0), 6)}${pad(pct(e.time, 0), 6)}${pad(bp(e.riskBp, 0), 6)}`
  );
}

function detail(id) {
  const list = trades[id];
  const elig = eligible[id];
  p(`\n## ${id}: by ticker, side (avg in bp per trade; t day-clustered; Sharpe/CAGR/maxDD on the 1/3-per-ticker portfolio)`);
  p(HDR);
  p(row('all', list, elig));
  for (const tk of TICKERS) p(row(tk, list.filter((t) => t.ticker === tk), elig));
  p(row('long', list.filter((t) => t.side > 0), elig));
  p(row('short', list.filter((t) => t.side < 0), elig));
  p(`\n## ${id}: by year (portfolio sum at 0 / 1 / 3 bp; trades; avg trade at 1 bp; per ticker sum at 1 bp)`);
  const y0 = yearSums(list, 0),
    y1 = yearSums(list, COSTS.primary),
    y3 = yearSums(list, COSTS.stress);
  p(`${padE('year', 6)}${pad('n', 5)}${pad('0 bp', 8)}${pad('1 bp', 8)}${pad('3 bp', 8)}${pad('avg1', 7)}${pad('SPY', 8)}${pad('QQQ', 8)}${pad('IWM', 8)}`);
  for (const y of [...new Set(list.map((t) => t.year))].sort()) {
    const ly = list.filter((t) => t.year === y);
    const tk = TICKERS.map((T) => ly.filter((t) => t.ticker === T).reduce((a, t) => a + netR(t, COSTS.primary), 0));
    p(
      `${padE(y, 6)}${pad(ly.length, 5)}${pad(pct(y0[y], 1), 8)}${pad(pct(y1[y], 1), 8)}${pad(pct(y3[y], 1), 8)}` +
        `${pad(bp(mean(ly.map((t) => netR(t, COSTS.primary)))), 7)}${tk.map((x) => pad(pct(x, 1), 8)).join('')}`,
    );
  }
}

// --- options (information only) --------------------------------------------------------------------------
const quoteCache = new Map();
function loadQuotes(ticker, date) {
  const key = `${ticker}${date}`;
  if (quoteCache.has(key)) return quoteCache.get(key);
  const file = `${dataDir}/quotes/${ticker}/${date}.json`;
  let quotes = null;
  if (existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const midnight = nyMidnight(date);
    const tag = date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
    quotes = new Map();
    for (const [sym, rows] of Object.entries(raw)) {
      const rest = sym.slice(ticker.length);
      if (!sym.startsWith(ticker) || rest.slice(0, 6) !== tag) continue;
      quotes.set(
        `${rest[6]}${Number(rest.slice(7)) / 1000}`,
        rows.map(([t, b, a]) => [(t - midnight) / 60000, b, a]).sort((x, y) => x[0] - y[0]),
      );
    }
  }
  quoteCache.clear(); // keep memory flat: one ticker-day at a time
  quoteCache.set(key, quotes);
  return quotes;
}
const quoteAtMin = (rows, m) => {
  if (!rows) return undefined;
  let lo = 0,
    hi = rows.length - 1,
    found;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= m) {
      found = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found && { bid: found[1], ask: found[2], age: m - found[0] };
};

function optionTrades(id) {
  const out = [];
  const skips = {};
  const list = trades[id]
    .filter((t) => t.date >= OPT_FROM && t.date <= OPT_TO)
    .sort((a, b) => (a.ticker + a.date).localeCompare(b.ticker + b.date));
  for (const t of list) {
    const s = sessions[t.ticker].get(t.date);
    const q = loadQuotes(t.ticker, t.date);
    const skip = (why) => (skips[why] = (skips[why] ?? 0) + 1);
    if (!q || !q.size) {
      skip('no 0DTE quotes that day');
      continue;
    }
    const spot = s.Cff[t.e - 1];
    const strike = Math.round(spot);
    const type = t.side > 0 ? 'C' : 'P';
    const rows = q.get(`${type}${strike}`);
    if (!rows) {
      skip('no 0DTE contract at the ATM strike');
      continue;
    }
    const inQ = quoteAtMin(rows, s.open + t.e);
    if (!inQ || !(inQ.ask > 0) || inQ.ask < inQ.bid) {
      skip('no usable ask at entry');
      continue;
    }
    const xm = t.reason === 'time' ? t.timeK : t.x + 1;
    const outQ = quoteAtMin(rows, s.open + xm);
    if (!outQ) {
      skip('no quote at exit');
      continue;
    }
    out.push({ ...t, strike, ask: inQ.ask, bid: Math.max(0, outQ.bid), inAge: inQ.age, spreadIn: inQ.ask - inQ.bid });
  }
  return { out, skips, total: list.length };
}
const optPnl = (o, extra) => 100 * (Math.max(0, o.bid - extra) - (o.ask + extra)) - 0.1;

function optionReport(id) {
  const { out, skips, total } = optionTrades(id);
  p(`\n## Options (information only): ${id}, ${OPT_FROM} → ${OPT_TO}, 0DTE ATM at the real ask, out at the real bid`);
  p(`share trades in range ${total}; option trades ${out.length}; skipped ${JSON.stringify(skips)}`);
  if (!out.length) return;
  p(
    `average premium $${mean(out.map((o) => o.ask)).toFixed(2)}; average spread at entry $${mean(out.map((o) => o.spreadIn)).toFixed(3)} ` +
      `(${pct(mean(out.map((o) => o.spreadIn / o.ask)), 1)} of the ask); median quote age at entry ${
        out.map((o) => o.inAge).sort((a, b) => a - b)[out.length >> 1]
      } min`,
  );
  p(`${padE('', 10)}${pad('n', 6)}${pad('net $', 10)}${pad('avg $', 8)}${pad('ret/prem', 9)}${pad('hit', 6)}${pad('t', 7)}${pad('stress $', 10)}${pad('t', 7)}${pad('harsh $', 10)}${pad('t', 7)}${pad('shares 1bp', 11)}`);
  const line = (label, l) => {
    if (!l.length) return p(`${padE(label, 10)}${pad(0, 6)}`);
    const v = (x) => l.map((o) => optPnl(o, x));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const tc = (x) => dayClusterT(l, (o) => optPnl(o, x));
    p(
      `${padE(label, 10)}${pad(l.length, 6)}${pad(sum(v(0)).toFixed(0), 10)}${pad(mean(v(0)).toFixed(2), 8)}` +
        `${pad(pct(mean(l.map((o) => optPnl(o, 0) / (100 * o.ask))), 1), 9)}${pad(pct(v(0).filter((x) => x > 0).length / l.length, 0), 6)}` +
        `${pad(f2(tc(0)), 7)}${pad(sum(v(0.01)).toFixed(0), 10)}${pad(f2(tc(0.01)), 7)}${pad(sum(v(0.02)).toFixed(0), 10)}${pad(f2(tc(0.02)), 7)}` +
        `${pad(bp(mean(l.map((o) => netR(o, COSTS.primary)))), 11)}`,
    );
  };
  line('all', out);
  for (const tk of TICKERS) line(tk, out.filter((o) => o.ticker === tk));
  line('calls', out.filter((o) => o.side > 0));
  line('puts', out.filter((o) => o.side < 0));
  for (const y of ['2024', '2025', '2026']) line(y, out.filter((o) => o.year === y));
  for (const r of ['stop', 'target', 'time']) line(`exit ${r}`, out.filter((o) => o.reason === r));
}

// --- check mode (slow path straight from the raw file, by wall clock) ----------------------------------
function runCheck(ticker, date) {
  const day = calendar.find((d) => d.date === date);
  const raw = JSON.parse(readFileSync(`${dataDir}/stocks/${ticker}/${date}.json`, 'utf8'));
  const bars = raw
    .map((b) => ({ ...b, ny: fmt.format(Date.parse(b.t)) }))
    .filter((b) => b.ny >= day.open && b.ny < day.close);
  const inT = (b, a, z) => b.ny >= a && b.ny < z;
  const boxBars = bars.filter((b) => inT(b, '09:30', '09:45'));
  const hi = Math.max(...boxBars.map((b) => b.h)),
    lo = Math.min(...boxBars.map((b) => b.l));
  p(`${ticker} ${date} (session ${day.open}-${day.close}); slow path from the raw file`);
  p(`box 09:30-09:44 from ${boxBars.length} bars: high ${hi} low ${lo} mid ${(hi + lo) / 2}`);
  let side = 0,
    boEnd = null,
    outcome = 'none',
    reEnd = null;
  for (let m = hhmm('09:45'); m + 5 <= hhmm('12:00'); m += 5) {
    const cb = bars.filter((b) => inT(b, clock(m), clock(m + 5)));
    if (!cb.length) continue;
    const c = { o: cb[0].o, h: Math.max(...cb.map((b) => b.h)), l: Math.min(...cb.map((b) => b.l)), c: cb.at(-1).c };
    let note = '';
    if (!side && m + 5 <= hhmm('11:30')) {
      if (c.c > hi) (side = 1), (boEnd = m + 5), (note = 'BREAKOUT LONG');
      else if (c.c < lo) (side = -1), (boEnd = m + 5), (note = 'BREAKOUT SHORT');
    } else if (side && outcome === 'none' && m + 5 - boEnd <= 60) {
      const edge = side > 0 ? hi : lo;
      if (side > 0 ? c.c <= edge : c.c >= edge) (outcome = 'void'), (note = 'VOID');
      else if (side > 0 ? c.l <= edge : c.h >= edge) (outcome = 'retest'), (reEnd = m + 5), (note = 'RETEST');
    }
    p(`  ${clock(m)}-${clock(m + 5)} o ${c.o} h ${c.h} l ${c.l} c ${c.c} ${note}`);
    if (outcome !== 'none' && m + 5 > (reEnd ?? boEnd) + 10) break;
  }
  if (side && outcome === 'none') outcome = 'expired';
  p(`slow path: side ${side} breakout candle ends ${boEnd ? clock(boEnd) : '-'}; outcome ${outcome}; retest ends ${reEnd ? clock(reEnd) : '-'}`);
  if (reEnd) {
    const eb = bars.find((b) => b.ny >= clock(reEnd));
    p(`  entry bar ${eb.ny} open ${eb.o}`);
  }
  // fast path
  const s = loadSession(ticker, day);
  for (const id of ['P', 'C-P']) {
    const cfg = CONFIGS.find((c) => c.id === id);
    const setup = findSetup(s, cfg);
    const t = tradeFor(s, setup, cfg);
    p(
      `fast path ${id}: box ${setup.box?.hi}/${setup.box?.lo} outcome ${setup.outcome ?? '-'} ` +
        (t
          ? `side ${t.side} entry ${clock(s.open + t.e)} @ ${t.entry} stop ${t.stop} target ${t.target?.toFixed?.(4)} R ${t.R.toFixed(4)} → ${t.reason} in bar ${clock(s.open + t.x)} @ ${t.exit} r(1bp) ${bp(netR(t, COSTS.primary))} bp`
          : 'no trade'),
    );
    if (t) {
      const path = bars.filter((b) => b.ny >= clock(s.open + t.e) && b.ny <= clock(s.open + t.x));
      const ext = path.reduce((a, b) => ({ h: Math.max(a.h, b.h), l: Math.min(a.l, b.l) }), { h: -Infinity, l: Infinity });
      p(`  raw bars entry..exit (${path.length}): high ${ext.h} low ${ext.l}; exit bar ${JSON.stringify(path.at(-1))}`);
    }
  }
}

// --- main ----------------------------------------------------------------------------------------------
if (CHECK) {
  runCheck(CHECK.ticker, CHECK.date);
  process.exit(0);
}
const t0 = Date.now();
runAll();
p(`H12 box-with-retest, shares 1× notional, ${FIRST_DATE} → ${LAST_DATE}; design: research/hypotheses/h12.md`);
p(`sessions loaded: ${JSON.stringify(nSessions)}; configs: ${CONFIGS.length} share configs (+2 option runs, info)`);
p(`counts: ${JSON.stringify(counts, null, 1)}`);
p('\n## Setups per retest config (breakouts and what happened after them)');
for (const [id, sc] of Object.entries(setupCounts)) {
  const tot = { days: 0, breakouts: 0, retest: 0, void: 0, expired: 0 };
  for (const v of Object.values(sc)) for (const k in tot) tot[k] += v[k];
  p(
    `${padE(id, 10)} box-days ${tot.days}  breakouts ${tot.breakouts} (${pct(tot.breakouts / tot.days, 0)})  retest ${tot.retest}  void ${tot.void}  expired ${tot.expired}  ` +
      TICKERS.map((T) => `${T} ${sc[T].breakouts}/${sc[T].retest}`).join('  '),
  );
}

p('\n## All configs, SPY+QQQ+IWM (avg in bp per trade, t day-clustered, Sharpe/CAGR/maxDD on the portfolio)');
p(HDR);
for (const c of CONFIGS) p(row(c.id, trades[c.id], eligible[c.id]));

p('\n## Per ticker, avg trade at 1 bp (t)');
p(`${padE('', 12)}${TICKERS.map((T) => pad(T, 16)).join('')}`);
for (const c of CONFIGS) {
  const cells = TICKERS.map((T) => {
    const l = trades[c.id].filter((t) => t.ticker === T);
    return pad(`${bp(mean(l.map((t) => netR(t, COSTS.primary))))} (${f2(dayClusterT(l, (t) => netR(t, COSTS.primary)))})`, 16);
  });
  p(`${padE(c.id, 12)}${cells.join('')}`);
}

detail('P');
detail('C-P');

// Control split by what the breakout did next under P's retest rule.
p('\n## The control C-P split by what the breakout did next (retest rule of P); entry at the breakout candle close');
p(HDR);
for (const g of ['retest', 'void', 'expired']) {
  p(row(`C-P ${g}`, trades['C-P'].filter((t) => t.group === g), eligible['C-P']));
  for (const tk of TICKERS) p(row(`  ${tk}`, trades['C-P'].filter((t) => t.group === g && t.ticker === tk), eligible['C-P']));
}
// Paired: on the retested breakouts, the retest entry vs the breakout entry, same days.
{
  const key = (t) => `${t.ticker}${t.date}`;
  const ctl = new Map(trades['C-P'].map((t) => [key(t), t]));
  const pairs = trades.P.filter((t) => ctl.has(key(t))).map((t) => [t, ctl.get(key(t))]);
  const d = pairs.map(([a, b]) => netR(a, COSTS.primary) - netR(b, COSTS.primary));
  p(
    `\npaired, same ${pairs.length} retested ticker-days: P avg ${bp(mean(pairs.map(([a]) => netR(a, COSTS.primary))))} bp, ` +
      `control avg ${bp(mean(pairs.map(([, b]) => netR(b, COSTS.primary))))} bp, difference ${bp(mean(d))} bp (t ${f2(tstat(d))}); ` +
      `control already stopped out before the retest entry: ${pairs.filter(([a, b]) => b.x < a.e).length}`,
  );
  p(
    `risk per trade (R as % of entry): P ${pct(mean(trades.P.map((t) => t.R / t.entry)), 3)}, C-P ${pct(mean(trades['C-P'].map((t) => t.R / t.entry)), 3)}`,
  );
}
// Control versions of the grid split the same way (information).
p('\n## Each grid control split by outcome (avg trade at 1 bp, n)');
for (const c of CONTROL) {
  const l = trades[c.id];
  p(
    `${padE(c.id, 14)}` +
      ['retest', 'void', 'expired']
        .map((g) => {
          const x = l.filter((t) => t.group === g);
          return `${g} ${bp(mean(x.map((t) => netR(t, COSTS.primary))))} (${x.length})`;
        })
        .join('   '),
  );
}

// Pass rule.
{
  const P = trades.P,
    ev = evaluate(P, eligible.P, COSTS.primary),
    ev1 = evaluate(trades['P+1min'], eligible['P+1min'], COSTS.primary),
    evc = evaluate(trades['C-P'], eligible['C-P'], COSTS.primary);
  const ys = yearSums(P, COSTS.primary);
  const posYears = FULL_YEARS.filter((y) => (ys[y] ?? 0) > 0).length;
  const posTk = TICKERS.filter((T) => mean(P.filter((t) => t.ticker === T).map((t) => netR(t, COSTS.primary))) > 0);
  const r1 = ev.avg > 0 && ev.t >= 2.5,
    r2 = posYears >= 7,
    r3 = posTk.length >= 2,
    r4 = ev1.avg > 0,
    r5 = ev.sharpe > evc.sharpe && ev.avg > evc.avg;
  p('\n## Pass rule (P, 1 bp per side)');
  p(`1. combined avg ${bp(ev.avg)} bp, day-clustered t ${f2(ev.t)} (needs > 0, t ≥ 2.5): ${r1 ? 'pass' : 'FAIL'}`);
  p(`2. positive full years ${posYears}/10 (needs ≥ 7): ${r2 ? 'pass' : 'FAIL'}`);
  p(`3. tickers with avg > 0: ${posTk.join(',') || 'none'} (needs ≥ 2): ${r3 ? 'pass' : 'FAIL'}`);
  p(`4. entry one minute later avg ${bp(ev1.avg)} bp (needs > 0): ${r4 ? 'pass' : 'FAIL'}`);
  p(`5. P Sharpe ${f2(ev.sharpe)} vs C-P ${f2(evc.sharpe)}; P avg ${bp(ev.avg, 2)} vs C-P ${bp(evc.avg, 2)} bp: ${r5 ? 'pass' : 'FAIL'}`);
  p(`VERDICT: ${r1 && r2 && r3 && r4 && r5 ? 'PASS' : 'FAIL'}${r1 && r2 && r3 && r4 && !r5 ? ' (a breakout effect, but the retest adds nothing)' : ''}`);
}

// Shares on the options period, for comparison with the options table.
p(`\n## Shares on the options period ${OPT_FROM} → ${OPT_TO} (information)`);
p(HDR);
for (const id of ['P', 'C-P']) {
  const el = new Set([...eligible[id]].filter((d) => d >= OPT_FROM && d <= OPT_TO));
  p(row(id, trades[id].filter((t) => t.date >= OPT_FROM && t.date <= OPT_TO), el));
}
optionReport('P');
optionReport('C-P');
p(`\nFinished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
