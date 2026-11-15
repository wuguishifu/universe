// Extracts qualifying insider purchases from the SEC Form 3/4/5 data sets (part 3 of LOG.md).
// usage: node research/tools/insider-extract.mjs <dir of *_form345.zip> <out.jsonl>
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [zipDir, outPath] = process.argv.slice(2);
if (!zipDir || !outPath) throw new Error('usage: insider-extract.mjs <zip dir> <out.jsonl>');

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** `30-MAR-2016` → `2016-03-30`. */
const isoDate = (s) => {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : undefined;
};

/** Rows of one TSV inside a zip, as objects. Lines are joined until they have every column, since free-text fields can hold newlines. */
function readTsv(zip, name) {
  const text = execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 30 }).toString('utf8');
  const lines = text.split('\n');
  const header = (lines.shift() ?? '').replace(/\r$/, '').split('\t');
  const rows = [];
  let pending = '';
  for (const line of lines) {
    pending = pending ? `${pending}\n${line}` : line;
    const cells = pending.replace(/\r$/, '').split('\t');
    if (cells.length < header.length) continue;
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
    pending = '';
  }
  return rows;
}

const stats = { filings: 0, form4: 0, withPurchase: 0, insiderOwner: 0, kept: 0 };
const out = [];
for (const file of readdirSync(zipDir).filter((f) => f.endsWith('_form345.zip')).sort()) {
  const zip = join(zipDir, file);
  const submissions = new Map(readTsv(zip, 'SUBMISSION.tsv').map((r) => [r.ACCESSION_NUMBER, r]));
  stats.filings += submissions.size;

  const purchases = new Map();
  for (const t of readTsv(zip, 'NONDERIV_TRANS.tsv')) {
    if (t.TRANS_CODE !== 'P' || t.TRANS_ACQUIRED_DISP_CD !== 'A') continue;
    const shares = Number(t.TRANS_SHARES);
    const price = Number(t.TRANS_PRICEPERSHARE);
    const date = isoDate(t.TRANS_DATE);
    if (!(shares > 0) || !(price > 0) || !date) continue;
    const list = purchases.get(t.ACCESSION_NUMBER) ?? [];
    list.push({ date, shares, price, title: t.SECURITY_TITLE });
    purchases.set(t.ACCESSION_NUMBER, list);
  }

  const owners = new Map();
  for (const o of readTsv(zip, 'REPORTINGOWNER.tsv')) {
    if (!purchases.has(o.ACCESSION_NUMBER)) continue;
    const list = owners.get(o.ACCESSION_NUMBER) ?? [];
    list.push({ cik: o.RPTOWNERCIK, name: o.RPTOWNERNAME, relationship: o.RPTOWNER_RELATIONSHIP, title: o.RPTOWNER_TITLE });
    owners.set(o.ACCESSION_NUMBER, list);
  }

  for (const [accession, sub] of submissions) {
    if (sub.DOCUMENT_TYPE !== '4') continue;
    stats.form4++;
    const buys = purchases.get(accession);
    if (!buys) continue;
    stats.withPurchase++;
    const filers = owners.get(accession) ?? [];
    if (!filers.some((o) => /Director|Officer/i.test(o.relationship))) continue;
    stats.insiderOwner++;
    const shares = buys.reduce((a, b) => a + b.shares, 0);
    const value = buys.reduce((a, b) => a + b.shares * b.price, 0);
    if (value < 10_000) continue;
    const filed = isoDate(sub.FILING_DATE);
    if (!filed) continue;
    stats.kept++;
    const dates = buys.map((b) => b.date).sort();
    out.push({
      accession,
      filed,
      cik: sub.ISSUERCIK,
      issuer: sub.ISSUERNAME,
      symbol: sub.ISSUERTRADINGSYMBOL.trim().toUpperCase(),
      owners: filers,
      shares,
      value,
      avgPrice: value / shares,
      firstTrade: dates[0],
      lastTrade: dates.at(-1),
    });
  }
  console.log(`${file}: ${out.length} purchases so far`);
}
writeFileSync(outPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify(stats));
