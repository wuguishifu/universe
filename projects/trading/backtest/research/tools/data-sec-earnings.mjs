// Earnings-release dates from SEC 8-K filings with Item 2.02 ("Results of Operations and Financial
// Condition"), for every issuer CIK in data/universe/sec-issuer-tickers.json.
// Output: data/sec/earnings-8k.jsonl, one line per filing:
//   { cik, accession, filed: "YYYY-MM-DD", accepted: "YYYY-MM-DDTHH:MM:SS" (New York time), items }
// Resumable: CIKs already in data/sec/earnings-8k-done.txt are skipped.
// usage: node research/tools/data-sec-earnings.mjs [--rate=4]
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const RATE = Number(args.rate ?? 4); // requests per second; SEC asks for at most 10
const UA = 'trading-backtest research script';
const OUT = 'data/sec/earnings-8k.jsonl';
const DONE = 'data/sec/earnings-8k-done.txt';
const FROM = '2015-10-01';

const ciks = [...new Set(JSON.parse(readFileSync('data/universe/sec-issuer-tickers.json', 'utf8')).map((r) => r.cik))];
const done = new Set(existsSync(DONE) ? readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : []);
const todo = ciks.filter((c) => !done.has(c));
console.log(`${ciks.length} CIKs, ${todo.length} to fetch`);

let last = 0;
async function get(url, attempt = 0) {
  const wait = last + 1000 / RATE - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
  if (res.status === 404) return null;
  if (res.ok) return res.json();
  if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 5) {
    await sleep(2000 * 2 ** attempt);
    return get(url, attempt + 1);
  }
  throw new Error(`${res.status} ${url}`);
}

// The accepted time is UTC-like text without zone in SEC JSON ("2024-05-02T16:05:12.000Z"): convert to New York.
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const toNy = (s) => {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const p = Object.fromEntries(ny.formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

function rows(cik, block) {
  const out = [];
  const n = block.accessionNumber?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const form = block.form[i];
    if (form !== '8-K' && form !== '8-K/A') continue;
    if (!String(block.items[i] ?? '').split(',').includes('2.02')) continue;
    if (block.filingDate[i] < FROM) continue;
    out.push({ cik, accession: block.accessionNumber[i], form, filed: block.filingDate[i], accepted: toNy(block.acceptanceDateTime[i]), items: block.items[i] });
  }
  return out;
}

let n = 0;
let filings = 0;
for (const cik of todo) {
  const padded = cik.padStart(10, '0');
  const sub = await get(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const found = [];
  if (sub) {
    found.push(...rows(cik, sub.filings.recent));
    for (const f of sub.filings.files ?? []) {
      if (f.filingTo < FROM) continue;
      const page = await get(`https://data.sec.gov/submissions/${f.name}`);
      if (page) found.push(...rows(cik, page));
    }
  }
  if (found.length) appendFileSync(OUT, found.map((r) => JSON.stringify(r)).join('\n') + '\n');
  appendFileSync(DONE, cik + '\n');
  filings += found.length;
  if (++n % 250 === 0) console.log(`${n}/${todo.length} CIKs, ${filings} earnings 8-Ks`);
}
// A run stopped between writing a CIK's filings and marking it done repeats them on resume: drop repeats.
const seen = new Set();
const lines = readFileSync(OUT, 'utf8').split('\n').filter((l) => {
  if (!l) return false;
  const key = JSON.parse(l).accession;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`Done: ${n} CIKs fetched this run, ${lines.length} earnings 8-Ks on file`);
