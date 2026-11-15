// usage: node analyze.mjs <run dir> [top N] [sortKey] [filter axis=label,...]
import { readFileSync } from 'node:fs';

const [dir, topArg = '15', sortKey = 'worstTicker', filterArg = ''] =
  process.argv.slice(2);
const filters = filterArg ? filterArg.split(',').map((f) => f.split('=')) : [];
const rows = readFileSync(`${dir}/results.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => r.train)
  .filter((r) => filters.every(([a, l]) => r.choices[a] === l));
const tickers = [
  ...new Set(rows.flatMap((r) => Object.keys(r.train.byTicker))),
].sort();
const years = [...new Set(rows.flatMap((r) => Object.keys(r.years)))].sort();
const money = (n) =>
  n == null ? '-' : `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(0)}`;
for (const r of rows) {
  const t = r.train;
  r.tickerNet = tickers.map((k) => t.byTicker[k]?.netPnl ?? 0);
  r.tickerT = tickers.map((k) => t.byTicker[k]?.tStat ?? 0);
  r.yearNet = years.map((y) => r.years[y]?.netPnl ?? 0);
  r.worstTicker = Math.min(...r.tickerNet);
  r.worstYear = Math.min(...r.yearNet);
  r.passDev =
    r.tickerNet.every((n) => n > 0) &&
    t.tStat >= 2.5 &&
    t.trades >= 300 &&
    r.yearNet.every((n) => n >= 0);
  r.tStat = t.tStat;
  r.netPnl = t.netPnl;
}
const n = rows.length;
const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(
  `${n} configs, ${rows.filter((r) => r.netPnl > 0).length} profitable, ${rows.filter((r) => r.tickerNet.every((x) => x > 0)).length} positive on all tickers, ${rows.filter((r) => r.passDev).length} pass the development rule`,
);
console.log(
  `t-stat: median ${med(rows.map((r) => r.tStat)).toFixed(2)}, max ${Math.max(...rows.map((r) => r.tStat)).toFixed(2)}; median net ${money(med(rows.map((r) => r.netPnl)))}`,
);
console.log(
  `median per ticker: ${tickers.map((k, i) => `${k} ${money(med(rows.map((r) => r.tickerNet[i])))}`).join(', ')}`,
);
console.log(
  `median per year: ${years.map((y, i) => `${y} ${money(med(rows.map((r) => r.yearNet[i])))}`).join(', ')}`,
);
rows.sort((a, b) => b[sortKey] - a[sortKey]);
const header = [
  'config',
  'trades',
  'net',
  't',
  'DD',
  ...tickers,
  ...years,
  'pass',
];
const out = rows
  .slice(0, Number(topArg))
  .map((r) => [
    Object.values(r.choices).join(' · '),
    String(r.train.trades),
    money(r.netPnl),
    r.tStat.toFixed(1),
    money(-r.train.maxDrawdown),
    ...r.tickerNet.map((x, i) => `${money(x)} (${r.tickerT[i].toFixed(1)})`),
    ...r.yearNet.map(money),
    r.passDev ? 'PASS' : '',
  ]);
const all = [header, ...out];
const w = header.map((_, i) => Math.max(...all.map((row) => row[i].length)));
console.log(`\nTop ${topArg} by ${sortKey}:`);
for (const row of all)
  console.log(
    row.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  '),
  );
