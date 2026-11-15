// Part 3: insider purchases, as pre-registered in LOG.md.
// usage: node research/tools/insider-study.mjs <data dir> [--sample-unpriced] [--gross]
// --gross drops trading costs (information only).
import fs from 'node:fs';

import { normalizeSymbol, readPurchases } from './insider-common.mjs';

const dataDir = process.argv[2] ?? 'data';
const HOLDS = [21, 63, 126];
const PRIMARY = 126;
const MIN_PRICE = 2;
const MIN_DOLLAR_VOLUME = 500_000;
const MIN_COST = 0.0005;
const MAX_COST = 0.02;
const DELIST_HAIRCUT = 0.7;
const MAX_GAP_DAYS = 30;
const CLUSTER_DAYS = 30;

const day = (date) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
// Daily bars are stamped at New York midnight (04:00 or 05:00 UTC), so the UTC date is the trading date.
const nyDate = (t) => t.slice(0, 10);

// --- Market calendar and benchmarks ------------------------------------------------------------
const loadBars = (ticker, adjustment) => {
  const path = `${dataDir}/${adjustment === 'raw' ? 'daily-raw' : 'daily'}/${ticker}.json`;
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8')).map((b) => ({ date: nyDate(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
};
const benchmark = Object.fromEntries(['SPY', 'IWM', 'BIL'].map((t) => [t, loadBars(t, 'all')]));
const dates = benchmark.BIL.map((b) => b.date);
const lastDate = dates.at(-1);
const dateIndex = new Map(dates.map((d, i) => [d, i]));
const benchClose = Object.fromEntries(Object.entries(benchmark).map(([t, bars]) => [t, new Map(bars.map((b) => [b.date, b]))]));

// --- Filings → candidate events -----------------------------------------------------------------
const purchases = readPurchases(fs, `${dataDir}/sec/purchases.jsonl`);
const isCeoCfo = (o) => /Officer/i.test(o.relationship) && /\b(CEO|CFO|CHIEF EXECUTIVE|CHIEF FINANCIAL)\b/i.test(o.title ?? '');
const insiders = (p) => p.owners.filter((o) => /Director|Officer/i.test(o.relationship));

const coverage = { filings: purchases.length, noTicker: 0, noBars: 0, noBarNearTrade: 0, priceMismatch: 0, checked: 0 };
const unpricedSamples = [];
const bySymbol = new Map();
for (const p of purchases) {
  const symbol = normalizeSymbol(p.symbol);
  if (!symbol) {
    coverage.noTicker++;
    continue;
  }
  const list = bySymbol.get(symbol) ?? [];
  list.push(p);
  bySymbol.set(symbol, list);
}

/** Abdi–Ranaldo (2017) spread from daily high, low and close; half of it is the cost per side. */
function halfSpread(bars, end, window = 63) {
  let sum = 0;
  let n = 0;
  for (let t = Math.max(0, end - window); t < end - 1; t++) {
    const a = bars[t];
    const b = bars[t + 1];
    if (!(a.h > 0 && a.l > 0 && b.h > 0 && b.l > 0 && a.c > 0)) continue;
    const c = Math.log(a.c);
    sum += (c - (Math.log(a.h) + Math.log(a.l)) / 2) * (c - (Math.log(b.h) + Math.log(b.l)) / 2);
    n++;
  }
  if (n < 10) return MAX_COST;
  const spread = Math.sqrt(Math.max(0, (4 * sum) / n));
  return Math.min(MAX_COST, Math.max(MIN_COST, spread / 2));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Index of the last bar on or before `date` within `maxDays`, or -1. */
function barOnOrBefore(bars, date, maxDays) {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && day(date) - day(bars[found].date) <= maxDays ? found : -1;
}

const skipped = { tooEarly: 0, noEntryBar: 0, price: 0, dollarVolume: 0, overlap: 0 };
const positions = Object.fromEntries(HOLDS.map((h) => [h, []]));

for (const [symbol, filings] of bySymbol) {
  const raw = loadBars(symbol, 'raw') ?? [];
  const adj = loadBars(symbol, 'all') ?? [];
  if (raw.length === 0 || adj.length === 0) {
    coverage.noBars += filings.length;
    unpricedSamples.push({ symbol, issuer: filings[0].issuer, filed: filings[0].filed });
    continue;
  }
  const rawByDate = new Map(raw.map((b) => [b.date, b]));

  // Ticker check: the filing's price must match what traded under this symbol.
  const valid = [];
  for (const f of filings) {
    coverage.checked++;
    const i = barOnOrBefore(raw, f.lastTrade, 7);
    if (i < 0) {
      coverage.noBarNearTrade++;
      continue;
    }
    const ratio = raw[i].c / f.avgPrice;
    if (ratio < 0.8 || ratio > 1.25) {
      coverage.priceMismatch++;
      continue;
    }
    valid.push(f);
  }

  // Group same-day filings into events.
  const byFiled = new Map();
  for (const f of valid) byFiled.set(f.filed, [...(byFiled.get(f.filed) ?? []), f]);
  const events = [...byFiled.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([filed, fs_]) => {
    const recent = valid.filter((f) => f.filed <= filed && day(filed) - day(f.filed) <= CLUSTER_DAYS);
    const recentInsiders = new Set(recent.flatMap((f) => insiders(f).map((o) => o.cik)));
    const owners = fs_.flatMap(insiders);
    return {
      symbol,
      filed,
      value: fs_.reduce((a, f) => a + f.value, 0),
      cluster: recentInsiders.size >= 2,
      ceoCfo: owners.some(isCeoCfo),
      directorsOnly: owners.every((o) => !/Officer/i.test(o.relationship)),
    };
  });

  for (const hold of HOLDS) {
    let busyUntil = '';
    for (const event of events) {
      // Entry: first bar after the filing date.
      let e = barOnOrBefore(adj, event.filed, 100000) + 1;
      if (adj[0].date > event.filed) e = 0;
      const entry = adj[e];
      if (!entry || day(entry.date) - day(event.filed) > 10) {
        if (hold === PRIMARY) skipped.noEntryBar++;
        continue;
      }
      if (entry.date <= busyUntil) {
        if (hold === PRIMARY) skipped.overlap++;
        continue;
      }
      if (e < 22) {
        if (hold === PRIMARY) skipped.tooEarly++;
        continue;
      }
      const prevRaw = rawByDate.get(adj[e - 1].date);
      if (!prevRaw || prevRaw.c < MIN_PRICE) {
        if (hold === PRIMARY) skipped.price++;
        continue;
      }
      const dollarVolume = median(
        adj.slice(e - 21, e).map((b) => {
          const r = rawByDate.get(b.date);
          return r ? r.c * r.v : 0;
        }),
      );
      if (dollarVolume < MIN_DOLLAR_VOLUME) {
        if (hold === PRIMARY) skipped.dollarVolume++;
        continue;
      }
      const cost = process.argv.includes('--gross') ? 0 : halfSpread(adj, e);

      // Walk the hold. A gap of more than MAX_GAP_DAYS ends the series there.
      let x = e;
      while (x + 1 < adj.length && x + 1 <= e + hold - 1 && day(adj[x + 1].date) - day(adj[x].date) <= MAX_GAP_DAYS) x++;
      const complete = x === e + hold - 1;
      const endedEarly = !complete && (x + 1 < adj.length || adj[x].date < lastDate);
      const lastRaw = rawByDate.get(adj[x].date);
      const delisted = endedEarly && ((lastRaw && lastRaw.c < 1) || adj[x].c < 0.5 * entry.o);

      // Daily returns on the market calendar; days the stock didn't trade count as 0.
      const startIndex = dateIndex.get(entry.date);
      const endIndex = dateIndex.get(adj[x].date);
      if (startIndex === undefined || endIndex === undefined) continue;
      const returns = new Float64Array(endIndex - startIndex + 1);
      returns[0] = adj[e].c / adj[e].o / (1 + cost) - 1;
      for (let t = e + 1; t <= x; t++) {
        const k = dateIndex.get(adj[t].date);
        if (k !== undefined) returns[k - startIndex] = adj[t].c / adj[t - 1].c - 1;
      }
      const lastIdx = returns.length - 1;
      const exitFactor = (complete || endedEarly ? 1 - cost : 1) * (delisted ? DELIST_HAIRCUT : 1);
      returns[lastIdx] = (1 + returns[lastIdx]) * exitFactor - 1;

      const total = returns.reduce((v, r) => v * (1 + r), 1) - 1;
      const iwmStart = benchClose.IWM.get(entry.date);
      const iwmEnd = benchClose.IWM.get(adj[x].date);
      positions[hold].push({
        ...event,
        entryDate: entry.date,
        exitDate: adj[x].date,
        startIndex,
        returns,
        total,
        excess: iwmStart && iwmEnd ? total - (iwmEnd.c / iwmStart.o - 1) : undefined,
        finished: complete || endedEarly,
        delisted,
        cost,
        dollarVolume,
      });
      busyUntil = adj[x].date;
    }
  }
}

// --- Calendar-time portfolios ---------------------------------------------------------------------
/** Daily portfolio returns. `weighting` is 'value' (each position at its value since entry) or 'equal' (re-equalized daily). */
function portfolio(list, weighting) {
  const num = new Float64Array(dates.length);
  const den = new Float64Array(dates.length);
  for (const p of list) {
    let value = 1;
    for (let k = 0; k < p.returns.length; k++) {
      const w = weighting === 'value' ? value : 1;
      num[p.startIndex + k] += w * p.returns[k];
      den[p.startIndex + k] += w;
      value *= 1 + p.returns[k];
    }
  }
  return dates.map((d, i) => ({ date: d, r: den[i] > 0 ? num[i] / den[i] : undefined, n: den[i] }));
}

const benchDaily = Object.fromEntries(
  Object.entries(benchmark).map(([t, bars]) => [t, new Map(bars.map((b, i) => [b.date, i === 0 ? 0 : b.c / bars[i - 1].c - 1]))]),
);

/** Compounds daily returns to months; days with no positions earn BIL. */
function monthly(daily) {
  const months = new Map();
  for (const { date, r } of daily) {
    const key = date.slice(0, 7);
    const m = months.get(key) ?? { p: 1, SPY: 1, IWM: 1, BIL: 1, days: 0 };
    const bil = benchDaily.BIL.get(date) ?? 0;
    m.p *= 1 + (r ?? bil);
    for (const t of ['SPY', 'IWM', 'BIL']) m[t] *= 1 + (benchDaily[t].get(date) ?? 0);
    m.days += r === undefined ? 0 : 1;
    months.set(key, m);
  }
  return [...months.entries()].filter(([, m]) => m.days > 0).map(([month, m]) => ({ month, p: m.p - 1, SPY: m.SPY - 1, IWM: m.IWM - 1, BIL: m.BIL - 1 }));
}

/** OLS of y on x with plain and Newey–West (3 lags) t-stats for the intercept. */
function regress(y, x) {
  const n = y.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const e = y.map((v, i) => v - alpha - beta * x[i]);
  const s2 = e.reduce((a, b) => a + b * b, 0) / (n - 2);
  const seAlpha = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  // Newey–West for the intercept, using the regressor-adjusted moment.
  const g = e.map((ei, i) => ei * (1 - (mx * (x[i] - mx)) / (sxx / n)));
  let lrv = g.reduce((a, b) => a + b * b, 0) / n;
  for (let L = 1; L <= 3; L++) {
    let c = 0;
    for (let i = L; i < n; i++) c += g[i] * g[i - L];
    lrv += 2 * (1 - L / 4) * (c / n);
  }
  const seNw = Math.sqrt(lrv / n);
  return { alpha, beta, t: alpha / seAlpha, tNw: alpha / seNw, n };
}

function analyze(list, weighting = 'value') {
  const months = monthly(portfolio(list, weighting));
  const y = months.map((m) => m.p - m.BIL);
  const vsIwm = regress(y, months.map((m) => m.IWM - m.BIL));
  const vsSpy = regress(y, months.map((m) => m.SPY - m.BIL));
  const years = {};
  for (const m of months) {
    const yk = m.month.slice(0, 4);
    const acc = (years[yk] ??= { p: 1, IWM: 1 });
    acc.p *= 1 + m.p;
    acc.IWM *= 1 + m.IWM;
  }
  const finished = list.filter((p) => p.finished && p.excess !== undefined);
  return {
    events: list.length,
    vsIwm,
    vsSpy,
    years: Object.fromEntries(Object.entries(years).map(([k, v]) => [k, v.p - v.IWM])),
    eventExcess: finished.reduce((a, p) => a + p.excess, 0) / (finished.length || 1),
    finished: finished.length,
  };
}

const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const line = (label, a) =>
  `${label.padEnd(34)} ${String(a.events).padStart(6)}  α/mo vs IWM ${pct(a.vsIwm.alpha).padStart(7)} (t ${a.vsIwm.t.toFixed(2).padStart(5)}, NW ${a.vsIwm.tNw.toFixed(2).padStart(5)}, β ${a.vsIwm.beta.toFixed(2)})  vs SPY ${pct(a.vsSpy.alpha).padStart(7)} (t ${a.vsSpy.t.toFixed(2).padStart(5)})  per-event excess ${pct(a.eventExcess).padStart(7)}`;

// --- Report ---------------------------------------------------------------------------------------
console.log('# Coverage');
console.log(JSON.stringify(coverage));
console.log(`entry filters (126-day hold): ${JSON.stringify(skipped)}`);

for (const hold of HOLDS) {
  const list = positions[hold];
  console.log(`\n# Hold ${hold} trading days${hold === PRIMARY ? ' (primary)' : ''}`);
  const main = analyze(list);
  console.log(line('All events, value-weighted', main));
  console.log(line('All events, re-equalized daily', analyze(list, 'equal')));
  if (hold === PRIMARY) {
    const costs = list.map((p) => p.cost).sort((a, b) => a - b);
    console.log(`cost per side: median ${pct(median(costs))}, 90th pct ${pct(costs[Math.floor(costs.length * 0.9)])}; delisted with haircut: ${list.filter((p) => p.delisted).length}; finished: ${main.finished}`);
    console.log('excess over IWM by year: ' + Object.entries(main.years).map(([y, v]) => `${y} ${pct(v, 1)}`).join('  '));

    const dv = list.map((p) => p.dollarVolume).sort((a, b) => a - b);
    const [t1, t2] = [dv[Math.floor(dv.length / 3)], dv[Math.floor((2 * dv.length) / 3)]];
    console.log('\nPredictions (value-weighted, vs IWM):');
    for (const [label, filter] of [
      ['1. Cluster (≥2 insiders in 30d)', (p) => p.cluster],
      ['1. Single insider', (p) => !p.cluster],
      ['2. Lowest dollar-volume third', (p) => p.dollarVolume < t1],
      ['2. Middle third', (p) => p.dollarVolume >= t1 && p.dollarVolume < t2],
      ['2. Highest third', (p) => p.dollarVolume >= t2],
      ['3. CEO or CFO buying', (p) => p.ceoCfo],
      ['3. Directors only', (p) => p.directorsOnly],
    ]) console.log(line(label, analyze(list.filter(filter))));
    console.log(`dollar-volume tercile cutoffs: $${(t1 / 1e6).toFixed(1)}M, $${(t2 / 1e6).toFixed(1)}M`);

    fs.writeFileSync(
      `${dataDir}/sec/positions-${hold}.csv`,
      ['symbol,filed,entry,exit,total,excess,cost,dollarVolume,cluster,ceoCfo,directorsOnly,delisted']
        .concat(list.map((p) => [p.symbol, p.filed, p.entryDate, p.exitDate, p.total.toFixed(4), p.excess?.toFixed(4) ?? '', p.cost.toFixed(4), Math.round(p.dollarVolume), p.cluster, p.ceoCfo, p.directorsOnly, p.delisted].join(',')))
        .join('\n') + '\n',
    );
  }
}

if (process.argv.includes('--sample-unpriced')) {
  // A fixed-seed sample, so the same 20 come out every run.
  let seed = 42;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const pool = [...unpricedSamples];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sample = pool.slice(0, 20);
  console.log('\n# 20 random unpriced tickers');
  for (const s of sample) console.log(`${s.symbol.padEnd(6)} ${s.filed}  ${s.issuer}`);
}
