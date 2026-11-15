// Scheduled FOMC announcement dates (the meeting's last day) from the Fed's calendar pages.
// usage: node research/tools/fomc-dates.mjs <dir with calendars.html and hist<YEAR>.html> > dates.json
import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'data/fomc';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (name) => MONTHS.findIndex((m) => m.startsWith(name.slice(0, 3))) + 1;
const text = (html) => html.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ');
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)?';

/** `Jan/Feb`, `31-1` → the second month and day. */
function lastDay(year, months, days) {
  const parts = months.split('/');
  const month = monthOf(parts.at(-1));
  const day = Number(days.replace('*', '').split('-').at(-1));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const dates = new Set();
// Historical pages: "<months> <days> Meeting - <year>". Unscheduled calls are headed differently.
for (const file of readdirSync(dir).filter((f) => /^hist\d{4}\.html$/.test(f))) {
  const t = text(readFileSync(`${dir}/${file}`, 'utf8'));
  for (const m of t.matchAll(new RegExp(`(${MONTH}) (\\d{1,2}(?:-\\d{1,2})?) Meeting - (\\d{4})`, 'g'))) {
    dates.add(lastDay(m[3], m[1], m[2]));
  }
}
// Current page: one panel per year; rows are "| <months> | | | <days>[*] |" followed by a statement.
const t = text(readFileSync(`${dir}/calendars.html`, 'utf8'));
const panels = [...t.matchAll(/(\d{4}) FOMC Meetings/g)];
panels.forEach((panel, i) => {
  const body = t.slice(panel.index, panels[i + 1]?.index ?? t.length);
  for (const m of body.matchAll(new RegExp(`\\| (${MONTH}) \\|[ |]*(\\d{1,2}(?:-\\d{1,2})?\\*?) \\|[ |]*(\\([^)]*\\))?`, 'g'))) {
    if (m[3]) continue; // (unscheduled), (notation vote)
    if (!m[2].includes('-')) continue; // single-day entries are calls, not scheduled two-day meetings
    dates.add(lastDay(panel[1], m[1], m[2]));
  }
});
console.log(JSON.stringify([...dates].sort(), null, 1));
