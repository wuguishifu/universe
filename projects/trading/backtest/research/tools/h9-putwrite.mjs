// H9: monthly index put-writing (cash-secured, closed before expiry), as pre-registered in
// research/hypotheses/h9.md. Real NBBO snapshots from data/chains (15:45 / 12:45).
// usage: node research/tools/h9-putwrite.mjs [--tickers=SPY,QQQ,IWM] [--to=YYYY-MM-DD]
//        [--lastMonth=YYYY-MM] [--trace=C1] [--traceN=10]
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const TICKERS = opt('tickers', 'SPY').split(',');
const FROM = '2020-01-02';
const TO = opt('to', '2026-11-13');
const LAST_MONTH = opt('lastMonth', '2026-10');
const TRACE = opt('trace', null);
const TRACE_N = +opt('traceN', 12);
const DATA = 'data';
const FEE = 0.05;
const COSTS = { primary: 0, stress: 0.01, harsh: 0.02 };
const DAY = 86400000;

// ---------------------------------------------------------------- configs (h9.md grid)
const SPY_CONFIGS = [
  { id: 'C1', otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5 },
  { id: 'C2', otm: 0.02, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5 },
  { id: 'C3', otm: 0.05, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5 },
  { id: 'C4', otm: 0, tenor: 45, win: [38, 60], exit: 'dte', exitD: 5 },
  { id: 'C5', otm: 0, tenor: 30, win: [25, 45], exit: 'tp', exitD: 5, tp: 0.5 },
  { id: 'C6', otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 21 },
  { id: 'C7', otm: 0, tenor: 45, win: [38, 60], exit: 'dte', exitD: 21 },
  { id: 'C8', otm: 0.05, tenor: 30, win: [25, 45], exit: 'tp', exitD: 5, tp: 0.5 },
  { id: 'D1', otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5, wing: 0.1 },
  { id: 'D2', otm: 0.05, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5, wing: 0.1 },
  { id: 'C1x', otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5, proxyExit: true },
  { id: 'D1x', otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5, wing: 0.1, proxyExit: true },
];
const OTHER_CONFIGS = (T) => [
  { id: `${T[0]}1`, otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5 },
  { id: `${T[0]}3`, otm: 0.05, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5 },
  { id: `${T[0]}1x`, otm: 0, tenor: 30, win: [25, 45], exit: 'dte', exitD: 5, proxyExit: true },
];

// ---------------------------------------------------------------- helpers
const out = [];
const log = (s = '') => {
  out.push(s);
  console.log(s);
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const tstat = (xs) => (mean(xs) / sdev(xs)) * Math.sqrt(xs.length);
const pct = (x, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const dnum = (d) => Date.parse(`${d}T00:00:00Z`) / DAY;
const daysBetween = (a, b) => dnum(b) - dnum(a);
const compound = (rs) => rs.reduce((p, r) => p * (1 + r), 1) - 1;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const calendar = readJson(`${DATA}/calendar.json`).filter((d) => d.date >= FROM && d.date <= TO);
const DATES = calendar.map((d) => d.date);
const CLOSE_TIME = Object.fromEntries(calendar.map((d) => [d.date, d.close]));
const allCal = readJson(`${DATA}/calendar.json`);
const ALL_DATES = allCal.map((d) => d.date);

function loadDaily(dir, T) {
  const m = new Map();
  for (const b of readJson(`${DATA}/${dir}/${T}.json`)) m.set(b.t.slice(0, 10), b.c);
  return m;
}
const ADJ = {};
const RAW = {};
for (const T of ['SPY', 'QQQ', 'IWM', 'BIL']) {
  ADJ[T] = loadDaily('daily', T);
  RAW[T] = loadDaily('daily-raw', T);
}
// last trading day <= d with a daily bar
function closeOnOrBefore(map, d) {
  let i = ALL_DATES.findIndex((x) => x > d);
  if (i < 0) i = ALL_DATES.length;
  for (let j = i - 1; j >= 0; j--) if (map.has(ALL_DATES[j])) return { date: ALL_DATES[j], c: map.get(ALL_DATES[j]) };
  return null;
}
const prevDate = (d) => {
  const i = ALL_DATES.indexOf(d);
  return ALL_DATES[i - 1];
};

// BIL trailing 63-day continuous yield; ticker trailing 365-day dividend yield (F = adj / raw)
function riskFree(d) {
  const i = ALL_DATES.indexOf(d);
  const a = ADJ.BIL.get(ALL_DATES[i]);
  const b = ADJ.BIL.get(ALL_DATES[i - 63]);
  return Math.log(a / b) * (252 / 63);
}
function divYield(T, d) {
  const F = (x) => ADJ[T].get(x) / RAW[T].get(x);
  const back = new Date((dnum(d) - 365) * DAY).toISOString().slice(0, 10);
  const p = closeOnOrBefore(ADJ[T], back);
  return Math.log(F(d) / F(p.date));
}

// ---------------------------------------------------------------- chain + spot
function loadChain(T, date) {
  const p = `${DATA}/chains/${T}/${date}.json`;
  if (!existsSync(p)) return null;
  const j = readJson(p);
  const puts = new Map();
  const calls = new Map();
  const tsCount = new Map();
  for (const [sym, rows] of Object.entries(j)) {
    const r = rows[rows.length - 1];
    tsCount.set(r[0], (tsCount.get(r[0]) ?? 0) + 1);
    const tail = sym.slice(-15);
    const exp = `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`;
    const K = +tail.slice(7) / 1000;
    const m = tail[6] === 'P' ? puts : calls;
    if (!m.has(exp)) m.set(exp, new Map());
    m.get(exp).set(K, { sym, bid: r[1], ask: r[2] });
  }
  let snap = null;
  let best = -1;
  for (const [t, c] of tsCount) if (c > best) [snap, best] = [t, c];
  return { puts, calls, snap };
}

// value of a put with no quote: intrinsic at the snapshot spot plus the time value of the
// highest-strike quoted put in the same expiry (dated note 1 in h9.md)
function proxyPrice(chain, exp, K, S, kind) {
  const em = chain.puts.get(exp);
  let Kp = null;
  if (em) for (const [k, q] of em) if (usableMark(q) && (Kp === null || k > Kp)) Kp = k;
  const intr = Math.max(K - S, 0);
  if (Kp === null) return intr;
  const q = em.get(Kp);
  const px = kind === 'ask' ? q.ask : kind === 'bid' ? q.bid : (q.bid + q.ask) / 2;
  return intr + Math.max(0, px - Math.max(Kp - S, 0));
}
const usableEntry = (q) => q && q.bid > 0 && q.ask > 0 && q.ask >= q.bid;
const usableMark = (q) => q && q.ask > 0 && q.bid >= 0 && q.ask >= q.bid;

const spotStats = { bar: 0, earlier: 0, parity: 0, none: 0 };
function getSpot(T, date, chain) {
  const p = `${DATA}/stocks/${T}/${date}.json`;
  if (existsSync(p)) {
    const bars = readJson(p);
    const target = chain.snap - 60000;
    let fallback = null;
    for (const b of bars) {
      const t = Date.parse(b.t);
      if (t === target) {
        spotStats.bar++;
        return b.c;
      }
      if (t < target && t >= chain.snap - 16 * 60000) fallback = b.c;
    }
    if (fallback !== null) {
      spotStats.earlier++;
      return fallback;
    }
  }
  // put-call parity on the same snapshot
  const prev = RAW[T].get(prevDate(date));
  const exps = [...chain.puts.keys()].filter((e) => daysBetween(date, e) >= 1).sort();
  for (const e of exps) {
    const P = chain.puts.get(e);
    const C = chain.calls.get(e);
    if (!C) continue;
    let bestK = null;
    for (const [K, q] of P) {
      const c = C.get(K);
      if (!usableEntry(q) || !usableEntry(c)) continue;
      if (bestK === null || Math.abs(K - prev) < Math.abs(bestK - prev)) bestK = K;
    }
    if (bestK !== null) {
      const q = P.get(bestK);
      const c = C.get(bestK);
      spotStats.parity++;
      return bestK + (c.bid + c.ask) / 2 - (q.bid + q.ask) / 2;
    }
  }
  spotStats.none++;
  return null;
}

// ---------------------------------------------------------------- selection
function pickExpiry(chain, date, cfg) {
  let best = null;
  for (const e of chain.puts.keys()) {
    const dte = daysBetween(date, e);
    if (dte < cfg.win[0] || dte > cfg.win[1]) continue;
    const d = Math.abs(dte - cfg.tenor);
    if (best === null || d < best.d || (d === best.d && e < best.e)) best = { e, d };
  }
  return best?.e ?? null;
}
// highest listed strike <= target; if unusable, nearest usable within 1% of it (tie -> lower)
function pickStrike(expMap, target, below = Infinity) {
  const ks = [...expMap.keys()].filter((k) => k < below).sort((a, b) => a - b);
  let tk = null;
  for (const k of ks) if (k <= target) tk = k;
  if (tk === null) return { K: null, fallback: false };
  if (usableEntry(expMap.get(tk))) return { K: tk, fallback: false };
  let best = null;
  for (const k of ks) {
    if (k === tk || !usableEntry(expMap.get(k)) || Math.abs(k - tk) > 0.01 * tk) continue;
    const dk = Math.abs(k - tk);
    if (best === null || dk < Math.abs(best - tk) || (dk === Math.abs(best - tk) && k < best)) best = k;
  }
  return { K: best, fallback: best !== null };
}
// exit days are chosen among days that have a chain file (dated note 2 in h9.md)
let AVAIL = DATES;
function exitDateFor(entry, exp, d) {
  const target = dnum(exp) - d;
  let best = null;
  for (const x of AVAIL) {
    if (x <= entry || x >= exp) continue;
    const dd = Math.abs(dnum(x) - target);
    if (best === null || dd < best.dd) best = { x, dd }; // ties keep the earlier
  }
  return best?.x ?? null;
}

// ---------------------------------------------------------------- normal / Black-Scholes
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function bsPut(S, K, T, r, q, v) {
  const sq = v * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * T) / sq;
  const d2 = d1 - sq;
  return K * Math.exp(-r * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1);
}
function impliedVol(price, S, K, T, r, q) {
  let lo = 0.005;
  let hi = 4;
  if (bsPut(S, K, T, r, q, lo) > price || bsPut(S, K, T, r, q, hi) < price) return NaN;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (bsPut(S, K, T, r, q, m) > price) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
function realisedVol(T, from, to) {
  const ds = ALL_DATES.filter((d) => d >= from && d <= to && ADJ[T].has(d));
  const rs = [];
  for (let i = 1; i < ds.length; i++) rs.push(Math.log(ADJ[T].get(ds[i]) / ADJ[T].get(ds[i - 1])));
  if (!rs.length) return NaN;
  return Math.sqrt((rs.reduce((a, r) => a + r * r, 0) / rs.length) * 252);
}

// ---------------------------------------------------------------- strategy state machine
function newState(cfg, costName, T) {
  return {
    proxyExit: !!cfg.proxyExit,
    cfg,
    T,
    costName,
    adder: COSTS[costName],
    cash: 1,
    pos: null,
    navs: [],
    rolls: [],
    stats: { entryDays: 0, skipNoExpiry: 0, skipNoStrike: 0, fallbackStrike: 0, staleMarks: 0, lateExit: 0, expirySettle: 0, tpExits: 0, proxyExits: 0 },
    diag: [],
    trace: TRACE === cfg.id && costName === 'primary',
  };
}

function step(st, date, chain, spot, bilR, first) {
  // spot is the snapshot underlying price (null only if it cannot be found)
  const { cfg, adder } = st;
  if (!first) st.cash *= 1 + bilR;
  if (st.pos) {
    const pos = st.pos;
    for (const leg of pos.legs) {
      const q = chain.puts.get(pos.exp)?.get(leg.K);
      if (usableMark(q)) {
        leg.mid = (q.bid + q.ask) / 2;
        leg.q = q;
      } else {
        leg.q = null;
        if (spot !== null) leg.mid = proxyPrice(chain, pos.exp, leg.K, spot, 'mid');
        st.stats.staleMarks++;
      }
    }
    if (date >= pos.exp) {
      // never expected: no usable quote until expiry -> intrinsic from the official close
      const c = closeOnOrBefore(RAW[st.T], pos.exp).c;
      let cost = 0;
      for (const leg of pos.legs) cost += -leg.sign * Math.max(leg.K - c, 0);
      st.cash -= pos.n * 100 * cost;
      st.stats.expirySettle++;
      closeRoll(st, date, cost, 'expiry');
    } else {
      const short = pos.legs[0];
      const due = date >= pos.exitDate;
      const tp = cfg.exit === 'tp' && short.q && short.q.ask + adder <= cfg.tp * pos.shortFill;
      if (due || tp) {
        const ok = pos.legs.every((l) => l.q && (l.sign < 0 ? l.q.ask > 0 : true));
        if (ok) {
          let cost = 0;
          for (const leg of pos.legs) {
            const px = leg.sign < 0 ? leg.q.ask + adder : Math.max(0, leg.q.bid - adder);
            leg.exitFill = px;
            cost += -leg.sign * px; // short: pay ask; long: receive bid
          }
          st.cash -= pos.n * 100 * cost + pos.n * FEE * pos.legs.length;
          if (tp && !due) st.stats.tpExits++;
          closeRoll(st, date, cost, tp && !due ? 'tp' : 'dte');
        } else if (due && st.proxyExit && spot !== null) {
          let cost = 0;
          for (const leg of pos.legs) {
            const px = leg.q
              ? leg.sign < 0
                ? leg.q.ask + adder
                : Math.max(0, leg.q.bid - adder)
              : leg.sign < 0
                ? proxyPrice(chain, pos.exp, leg.K, spot, 'ask') + adder
                : Math.max(0, proxyPrice(chain, pos.exp, leg.K, spot, 'bid') - adder);
            cost += -leg.sign * px;
          }
          st.cash -= pos.n * 100 * cost + pos.n * FEE * pos.legs.length;
          st.stats.proxyExits++;
          closeRoll(st, date, cost, 'proxy');
        } else if (due) st.stats.lateExit++;
      }
    }
  }
  if (!st.pos && spot !== null) tryEntry(st, date, chain, spot);
  let nav = st.cash;
  if (st.pos) for (const leg of st.pos.legs) nav += leg.sign * st.pos.n * 100 * leg.mid;
  st.navs.push({ date, nav });
}

function closeRoll(st, date, exitCost, how) {
  const pos = st.pos;
  const fees = FEE * pos.legs.length * 2;
  const r = {
    entry: pos.entry,
    exit: date,
    exp: pos.exp,
    K: pos.legs[0].K,
    K2: pos.legs[1]?.K,
    S: pos.S,
    credit: pos.credit,
    exitCost,
    how,
    pnl: 100 * (pos.credit - exitCost) - (how === 'expiry' ? fees / 2 : fees),
    capital: pos.capital,
  };
  st.rolls.push(r);
  if (st.trace && st.rolls.length <= TRACE_N)
    log(
      `  trace ${st.cfg.id} ${st.T}: ${r.entry} S=${f2(r.S)} sell ${pos.exp} ${r.K}${r.K2 ? `/${r.K2}` : ''} credit ${f2(r.credit, 3)}` +
        ` (${pos.legs.map((l) => `${l.entryQ.bid}x${l.entryQ.ask}`).join(', ')}) -> ${date} ${how} cost ${f2(exitCost, 3)}` +
        ` (${pos.legs.map((l) => (l.q ? `${l.q.bid}x${l.q.ask}` : 'none')).join(', ')}) pnl/contract $${f2(r.pnl)}`,
    );
  st.pos = null;
}

function tryEntry(st, date, chain, spot) {
  const { cfg, adder } = st;
  st.stats.entryDays++;
  const exp = pickExpiry(chain, date, cfg);
  if (!exp) {
    st.stats.skipNoExpiry++;
    return;
  }
  const em = chain.puts.get(exp);
  const s = pickStrike(em, spot * (1 - cfg.otm));
  if (s.K === null) {
    st.stats.skipNoStrike++;
    return;
  }
  let w = null;
  if (cfg.wing) {
    w = pickStrike(em, s.K - cfg.wing * spot, s.K);
    if (w.K === null) {
      st.stats.skipNoStrike++;
      return;
    }
  }
  if (s.fallback || w?.fallback) st.stats.fallbackStrike++;
  const qs = em.get(s.K);
  const legs = [{ K: s.K, sign: -1, mid: (qs.bid + qs.ask) / 2, q: qs, entryQ: qs, fill: Math.max(0, qs.bid - adder) }];
  if (w) {
    const ql = em.get(w.K);
    legs.push({ K: w.K, sign: 1, mid: (ql.bid + ql.ask) / 2, q: ql, entryQ: ql, fill: ql.ask + adder });
  }
  const credit = legs.reduce((a, l) => a - l.sign * l.fill, 0);
  const capPer = w ? s.K - w.K : s.K;
  const nav = st.cash; // no position open
  const n = nav / (capPer * 100);
  st.cash += n * 100 * credit - n * FEE * legs.length;
  st.pos = {
    entry: date,
    exp,
    exitDate: exitDateFor(date, exp, cfg.exitD),
    legs,
    n,
    S: spot,
    credit,
    shortFill: legs[0].fill,
    capital: capPer * 100,
  };
  if (st.costName === 'primary' && !w && cfg.otm === 0 && cfg.tenor === 30 && cfg.exit === 'dte' && cfg.exitD === 5 && !cfg.proxyExit) {
    const T = (Date.parse(`${exp}T${CLOSE_TIME[exp] ?? '16:00'}:00-05:00`) - chain.snap) / (365 * DAY);
    const r = riskFree(date);
    const q = divYield(st.T, date);
    st.diag.push({ entry: date, exp, exitDate: st.pos.exitDate, K: s.K, S: spot, bid: qs.bid, ask: qs.ask, mid: (qs.bid + qs.ask) / 2, iv: impliedVol((qs.bid + qs.ask) / 2, spot, s.K, T, r, q), r, q });
  }
}

// ---------------------------------------------------------------- monthly series + stats
function monthEnds() {
  const ends = [];
  for (let i = 0; i < DATES.length; i++) {
    const m = DATES[i].slice(0, 7);
    if (m > LAST_MONTH) break;
    if (i === DATES.length - 1 || DATES[i + 1].slice(0, 7) !== m) ends.push({ m, date: DATES[i] });
  }
  return ends;
}
function monthlyFromDaily(daily, ends, base) {
  // daily: Map date -> value; base value for the first month
  const rs = [];
  let prev = base;
  for (const { date } of ends) {
    const v = daily.get(date);
    rs.push(v / prev - 1);
    prev = v;
  }
  return rs;
}
function ols(y, x, nwLag = 0) {
  const n = y.length;
  const xm = mean(x);
  const ym = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xm) ** 2;
    sxy += (x[i] - xm) * (y[i] - ym);
  }
  const b = sxy / sxx;
  const a = ym - b * xm;
  const e = y.map((yi, i) => yi - a - b * x[i]);
  // (X'X)^-1 for [1, x]
  const sx = x.reduce((s, v) => s + v, 0);
  const sx2 = x.reduce((s, v) => s + v * v, 0);
  const det = n * sx2 - sx * sx;
  const inv = [
    [sx2 / det, -sx / det],
    [-sx / det, n / det],
  ];
  const meat = (L) => {
    const S = [
      [0, 0],
      [0, 0],
    ];
    const add = (i, j, w) => {
      const u = [1, x[i]];
      const v = [1, x[j]];
      const k = w * e[i] * e[j];
      for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) S[p][q] += k * (u[p] * v[q] + (i !== j ? v[p] * u[q] : 0));
    };
    for (let i = 0; i < n; i++) add(i, i, 1);
    for (let l = 1; l <= L; l++) for (let i = l; i < n; i++) add(i, i - l, 1 - l / (L + 1));
    return S;
  };
  const sand = (S, scale) => {
    const m = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
    const V = m(m(inv, S), inv);
    return V.map((r) => r.map((v) => v * scale));
  };
  const Vhc = sand(meat(0), n / (n - 2));
  const Vnw = sand(meat(nwLag), n / (n - 2));
  const ssr = e.reduce((s, v) => s + v * v, 0);
  const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
  return { a, b, tA: a / Math.sqrt(Vhc[0][0]), seA: Math.sqrt(Vhc[0][0]), tB: b / Math.sqrt(Vhc[1][1]), tAnw: a / Math.sqrt(Vnw[0][0]), r2: 1 - ssr / sst, resid: sdev(e) };
}
const cagr = (rs) => (1 + compound(rs)) ** (12 / rs.length) - 1;
const sharpe = (ex) => (mean(ex) / sdev(ex)) * Math.sqrt(12);
function maxDD(values) {
  let peak = -Infinity;
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return dd;
}
function navMaxDD(rs) {
  const vals = [1];
  for (const r of rs) vals.push(vals.at(-1) * (1 + r));
  return maxDD(vals);
}

// ---------------------------------------------------------------- run
const ends = monthEnds();
const MONTHS = ends.map((e) => e.m);
const idxM = (m) => MONTHS.indexOf(m);
const sliceM = (rs, a, b) => rs.filter((_, i) => MONTHS[i] >= a && MONTHS[i] <= b);
log(`# H9 put-write — ${TICKERS.join(', ')} — snapshots ${FROM} → ${TO}; months ${MONTHS[0]} → ${MONTHS.at(-1)} (${MONTHS.length})`);
log('');

const bilMonthly = monthlyFromDaily(ADJ.BIL, ends, ADJ.BIL.get(FROM));
const results = {};

for (const T of TICKERS) {
  const cfgs = T === 'SPY' ? SPY_CONFIGS : OTHER_CONFIGS(T);
  AVAIL = DATES.filter((d) => existsSync(`${DATA}/chains/${T}/${d}.json`));
  log(`${T}: ${AVAIL.length} of ${DATES.length} trading days have a chain file; missing: ${DATES.filter((d) => !AVAIL.includes(d)).join(' ') || 'none'}`);
  const states = [];
  for (const cfg of cfgs) for (const c of Object.keys(COSTS)) states.push(newState(cfg, c, T));
  const spotSeries = new Map(); // snapshot-aligned total-return index (15:45 spot x dividend factor)
  let lastDate = null;
  let missing = 0;
  for (let i = 0; i < DATES.length; i++) {
    const date = DATES[i];
    const chain = loadChain(T, date);
    if (!chain) {
      missing++;
      if (DATES.slice(i).every((d) => !existsSync(`${DATA}/chains/${T}/${d}.json`))) break;
      // a gap inside the sample: carry NAVs (counted)
      for (const st of states) {
        if (i > 0) st.cash *= 1 + (ADJ.BIL.get(date) / ADJ.BIL.get(DATES[i - 1]) - 1);
        let nav = st.cash;
        if (st.pos) for (const leg of st.pos.legs) nav += leg.sign * st.pos.n * 100 * leg.mid;
        st.navs.push({ date, nav });
      }
      continue;
    }
    const spot = getSpot(T, date, chain);
    if (spot !== null) spotSeries.set(date, spot * (ADJ[T].get(date) / RAW[T].get(date)));
    const bilR = i === 0 ? 0 : ADJ.BIL.get(date) / ADJ.BIL.get(DATES[i - 1]) - 1;
    for (const st of states) step(st, date, chain, spot, bilR, i === 0);
    lastDate = date;
  }
  log(`## ${T}`);
  log('');
  log(`Chain files used through ${lastDate}; gaps inside the sample: ${missing}. Spot source so far (all tickers): ${JSON.stringify(spotStats)}`);
  const usableEnds = ends.filter((e) => e.date <= lastDate);
  const nM = usableEnds.length;
  const months = MONTHS.slice(0, nM);
  const etf = monthlyFromDaily(ADJ[T], usableEnds, ADJ[T].get(FROM));
  const spy = monthlyFromDaily(ADJ.SPY, usableEnds, ADJ.SPY.get(FROM));
  const bil = bilMonthly.slice(0, nM);
  const etfSnap = monthlyFromDaily(spotSeries, usableEnds, spotSeries.get(FROM));
  const mix = etf.map((r, i) => 0.5 * r + 0.5 * bil[i]);
  const ex = (rs) => rs.map((r, i) => r - bil[i]);

  const periods = [
    ['Feb–Mar 2020', '2020-02', '2020-03'],
    ['2022', '2022-01', '2022-12'],
    ['Apr 2025', '2025-04', '2025-04'],
  ];
  const sel = (rs, a, b) => rs.filter((_, i) => months[i] >= a && months[i] <= b);
  const row = (name, rs, dailyDD) => {
    const e = ex(rs);
    const reg = ols(e, ex(etf), 3);
    const worst = Math.min(...rs);
    const wm = months[rs.indexOf(worst)];
    return `| ${name} | ${pct(cagr(rs))} | ${f2(sharpe(e))} | ${pct(sdev(rs) * Math.sqrt(12), 1)} | ${pct(navMaxDD(rs), 1)}${dailyDD !== undefined ? ` (${pct(dailyDD, 1)})` : ''} | ${pct(worst, 1)} ${wm} | ${periods.map(([, a, b]) => pct(compound(sel(rs, a, b)), 1)).join(' | ')} | ${pct(reg.a, 3)} (${f2(reg.tA)}) | ${f2(reg.b)} |`;
  };
  const header = `| series | CAGR | Sharpe | vol | max DD monthly (daily) | worst month | ${periods.map((p) => p[0]).join(' | ')} | alpha/mo vs ${T} (HC t) | beta |`;
  const sep = `|${' --- |'.repeat(10)}`;

  log('');
  log('### Benchmarks');
  log('');
  log(header);
  log(sep);
  log(row(`${T} total return`, etf));
  if (T !== 'SPY') log(row('SPY total return', spy));
  log(row(`50/50 ${T}/BIL`, mix));
  log(row('BIL', bil));
  log('');

  results[T] = {};
  for (const cfg of cfgs) {
    log(`### ${cfg.id} — ${cfg.otm ? `${cfg.otm * 100}% OTM` : 'ATM'}, ${cfg.tenor}d (${cfg.win.join('–')}), exit ${cfg.exit === 'tp' ? `${cfg.tp * 100}% of credit else ` : ''}${cfg.exitD}d before expiry${cfg.wing ? `, long wing ${cfg.wing * 100}% further OTM, capital = width` : ', cash-secured'}`);
    log('');
    log(header);
    log(sep);
    for (const st of states.filter((s) => s.cfg === cfg)) {
      const navMap = new Map(st.navs.map((x) => [x.date, x.nav]));
      const rs = monthlyFromDaily(navMap, usableEnds, 1);
      const dailyDD = maxDD(st.navs.filter((x) => x.date <= usableEnds.at(-1).date).map((x) => x.nav));
      log(row(st.costName, rs, dailyDD));
      st.monthly = rs;
    }
    log('');
    const prim = states.find((s) => s.cfg === cfg && s.costName === 'primary');
    const stress = states.find((s) => s.cfg === cfg && s.costName === 'stress');
    const harsh = states.find((s) => s.cfg === cfg && s.costName === 'harsh');
    results[T][cfg.id] = { prim, stress, harsh };
    const e = ex(prim.monthly);
    const regs = [
      ['all months', months[0], months.at(-1)],
      ['2020-01 → 2022-12', '2020-01', '2022-12'],
      ['2023-01 → 2026-10', '2023-01', '2026-10'],
      ['2021-01 → 2026-10 (2020 excluded)', '2021-01', '2026-10'],
    ];
    log('| regression (primary) | n | alpha/mo | alpha/yr | HC1 t | NW(3) t | SE alpha/mo | beta (t) | R² | resid sd/mo | Sharpe | ETF Sharpe |');
    log(`|${' --- |'.repeat(12)}`);
    for (const [name, a, b] of regs) {
      const y = sel(e, a, b);
      if (y.length < 6) continue;
      const x = sel(ex(etf), a, b);
      const g = ols(y, x, 3);
      log(`| ${name} | ${y.length} | ${pct(g.a, 3)} | ${pct(g.a * 12, 2)} | ${f2(g.tA)} | ${f2(g.tAnw)} | ${pct(g.seA, 3)} | ${f2(g.b)} (${f2(g.tB, 1)}) | ${f2(g.r2)} | ${pct(g.resid, 2)} | ${f2(sharpe(y))} | ${f2(sharpe(x))} |`);
    }
    {
      const g = ols(e, ex(etfSnap), 3);
      log(`| all, vs 15:45-aligned ${T} TR (info) | ${e.length} | ${pct(g.a, 3)} | ${pct(g.a * 12, 2)} | ${f2(g.tA)} | ${f2(g.tAnw)} | ${pct(g.seA, 3)} | ${f2(g.b)} (${f2(g.tB, 1)}) | ${f2(g.r2)} | ${pct(g.resid, 2)} | | |`);
      if (T !== 'SPY') {
        const h = ols(e, ex(spy), 3);
        log(`| all, vs SPY TR (info) | ${e.length} | ${pct(h.a, 3)} | ${pct(h.a * 12, 2)} | ${f2(h.tA)} | ${f2(h.tAnw)} | ${pct(h.seA, 3)} | ${f2(h.b)} (${f2(h.tB, 1)}) | ${f2(h.r2)} | ${pct(h.resid, 2)} | | |`);
      }
      for (const s of [stress, harsh]) {
        const gs = ols(ex(s.monthly), ex(etf), 3);
        log(`| all, ${s.costName} costs | ${e.length} | ${pct(gs.a, 3)} | ${pct(gs.a * 12, 2)} | ${f2(gs.tA)} | ${f2(gs.tAnw)} | ${pct(gs.seA, 3)} | ${f2(gs.b)} | ${f2(gs.r2)} | | ${f2(sharpe(ex(s.monthly)))} | |`);
      }
    }
    log('');
    // per-roll stats (primary)
    const rolls = prim.rolls.filter((r) => r.pnl !== null && r.exit <= usableEnds.at(-1).date);
    const retCap = rolls.map((r) => r.pnl / r.capital);
    const hold = mean(rolls.map((r) => daysBetween(r.entry, r.exit)));
    const s = prim.stats;
    log(
      `Rolls (primary, closed by ${usableEnds.at(-1).date}): ${rolls.length}; mean hold ${f2(hold, 1)} days; mean credit $${f2(mean(rolls.map((r) => r.credit)), 3)} (${pct(mean(rolls.map((r) => r.credit / (r.K2 ? r.K - r.K2 : r.K))), 2)} of ${cfg.wing ? 'width' : 'strike'}); ` +
        `mean exit cost $${f2(mean(rolls.map((r) => r.exitCost)), 3)}; P&L per contract mean $${f2(mean(rolls.map((r) => r.pnl)))}, ` +
        `per roll on capital ${pct(mean(retCap), 3)} (t ${f2(tstat(retCap))}), win ${pct(rolls.filter((r) => r.pnl > 0).length / rolls.length, 0)}, worst ${pct(Math.min(...retCap), 1)}.`,
    );
    log(
      `Data: entry attempts ${s.entryDays}, skipped (no expiry in window) ${s.skipNoExpiry}, skipped (no usable strike within 1%) ${s.skipNoStrike}, strike fallbacks ${s.fallbackStrike}, ` +
        `stale marks ${s.staleMarks}, exits delayed (no quote) ${s.lateExit}, settled at expiry ${s.expirySettle}, proxy exits ${s.proxyExits}${cfg.exit === 'tp' ? `, take-profit exits ${s.tpExits}` : ''}. ` +
        `Coverage = rolls without a skip: ${pct(1 - (s.skipNoExpiry + s.skipNoStrike) / Math.max(1, s.entryDays), 1)}.`,
    );
    log('');
    if (cfg.id === 'C1' || cfg.id === `${T[0]}1`) {
      // per-year table
      log('| year | strategy | ' + T + ' | 50/50 | BIL |');
      log('| --- | --- | --- | --- | --- |');
      for (const y of [...new Set(months.map((m) => m.slice(0, 4)))]) {
        const a = `${y}-01`;
        const b = `${y}-12`;
        log(`| ${y} | ${pct(compound(sel(prim.monthly, a, b)), 1)} | ${pct(compound(sel(etf, a, b)), 1)} | ${pct(compound(sel(mix, a, b)), 1)} | ${pct(compound(sel(bil, a, b)), 1)} |`);
      }
      log('');
      // implied vs realised
      const D = prim.diag.filter((d) => d.exp <= TO && d.exitDate && d.exitDate <= TO);
      for (const d of D) {
        const roll = prim.rolls.find((r) => r.entry === d.entry);
        d.exitAsk = roll ? roll.exitCost : NaN;
        d.payoff = Math.max(d.K - closeOnOrBefore(RAW[T], d.exp).c, 0);
        d.rvExit = realisedVol(T, d.entry, roll?.exit ?? d.exitDate);
        d.rvExp = realisedVol(T, d.entry, closeOnOrBefore(RAW[T], d.exp).date);
        d.spr = d.ask - d.bid;
      }
      const ok = D.filter((d) => Number.isFinite(d.iv) && Number.isFinite(d.exitAsk));
      const m = (f) => mean(ok.map(f));
      log(`Implied vs realised, ${T} ATM, primary entries with known expiry (${ok.length} of ${D.length} with a finite IV and an exit):`);
      log('');
      log(`- Entry put: bid $${f2(m((d) => d.bid), 3)}, mid $${f2(m((d) => d.mid), 3)}, ask $${f2(m((d) => d.ask), 3)}; mean spread $${f2(m((d) => d.spr), 3)} (${pct(m((d) => d.spr / d.mid), 2)} of mid); bid = ${pct(m((d) => d.bid / d.K), 3)} of strike.`);
      log(`- Payoff at expiry from the official close: $${f2(m((d) => d.payoff), 3)} (${pct(m((d) => d.payoff / d.K), 3)} of strike). Bid − payoff: mean $${f2(m((d) => d.bid - d.payoff), 3)}, t ${f2(tstat(ok.map((d) => (d.bid - d.payoff) / d.K)))}, bid > payoff in ${pct(ok.filter((d) => d.bid > d.payoff).length / ok.length, 0)}.`);
      log(`- Ask paid at the exit snapshot: $${f2(m((d) => d.exitAsk), 3)}. Bid − exit ask: mean $${f2(m((d) => d.bid - d.exitAsk), 3)}, t ${f2(tstat(ok.map((d) => (d.bid - d.exitAsk) / d.K)))}.`);
      const gapE = ok.map((d) => d.iv - d.rvExit);
      const gapX = ok.map((d) => d.iv - d.rvExp);
      log(`- IV (mid, BS, r = BIL trailing ${pct(m((d) => d.r), 2)} avg, q = trailing div yield ${pct(m((d) => d.q), 2)} avg): mean ${pct(m((d) => d.iv), 1)}; RV entry→exit ${pct(m((d) => d.rvExit), 1)}, entry→expiry ${pct(m((d) => d.rvExp), 1)}.`);
      log(`- IV − RV(to exit): mean ${f2(mean(gapE) * 100, 2)} vol pts, median ${f2(gapE.slice().sort((a, b) => a - b)[gapE.length >> 1] * 100, 2)}, t ${f2(tstat(gapE))}, positive ${pct(gapE.filter((g) => g > 0).length / gapE.length, 0)}. IV − RV(to expiry): mean ${f2(mean(gapX) * 100, 2)}, t ${f2(tstat(gapX))}, positive ${pct(gapX.filter((g) => g > 0).length / gapX.length, 0)}.`);
      const byYear = {};
      for (const d of ok) (byYear[d.entry.slice(0, 4)] ??= []).push(d);
      log(`- By entry year (IV − RV to exit, vol pts; bid − payoff as % of strike): ${Object.entries(byYear).map(([y, ds]) => `${y} ${f2(mean(ds.map((d) => d.iv - d.rvExit)) * 100, 1)} / ${pct(mean(ds.map((d) => (d.bid - d.payoff) / d.K)), 2)} (n ${ds.length})`).join('; ')}`);
      log('');
    }
  }
}

if (args.includes('--json')) console.error(JSON.stringify({ spotStats }));
