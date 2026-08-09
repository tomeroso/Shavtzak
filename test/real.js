const fs = require('fs'), path = require('path');
require('../shared/match.js');
const P = require('../shared/parse.js');
const M = globalThis.SHMatch;

const FIX = require('./fixtures.js');
const tabs = FIX.tabs(P);
if (!tabs) { FIX.skip('the real-sheet test'); process.exit(0); }

const TZ = 'Asia/Jerusalem';
const NOW = new Date('2026-08-05T12:30:00Z');   // 15:30 in Israel
const L = d => d.toLocaleString('he-IL', { timeZone: TZ });
const LD = d => d.toLocaleDateString('he-IL', { timeZone: TZ });
const LT = d => d.toLocaleTimeString('he-IL', { timeZone: TZ });
for (const t of tabs) {
  const r = P.parseGrid(t, { now: NOW, tz: TZ });
  const d = r.shifts.length ? null : P.parseDirectory(t);
  console.log(`\n── ${t.title}: shifts=${r.shifts.length} posts=${r.posts.length} axes=${JSON.stringify(r.axes || {})}${d ? ` directory=${d.people.length}` : ''}`);
  if (r.shifts.length) {
    console.log('   posts:', r.posts.join(' | '));
    const days = Array.from(new Set(r.shifts.map(s => LD(s.start))));
    console.log('   days:', days.join(', '));
    console.log('   sample:', r.shifts.slice(0, 3).map(s => `${s.name}@${s.post} ${L(s.start)}`).join(' ;; '));
  }
  if (d) console.log('   people:', d.people.slice(0, 4).map(p => `${p.name}[${p.loc}]`).join(' | '), '…');
}

const R = P.parseWorkbook(tabs, { now: NOW, tz: TZ });
console.log(`\n══ workbook: ${R.shifts.length} shifts · ${R.names.length} people · schedule tabs: ${R.scheduleTabs.join(', ')}`);
console.log('warnings:', R.warnings.length);
const merged = Object.entries(R.aliases);
console.log(`\nmerged spelling variants (${merged.length}):`);
merged.slice(0, 20).forEach(([k, v]) => console.log('  ', k, ' ⟸ ', v.join(' / ')));

console.log('\n── fuzzy lookups');
for (const q of ['tomer osovizky', 'אוסוביצקי', 'oso', 'אוס', 'תומר', 'תמר אוסוביצקי',
  'osovizky tomer', 'דנציקוב', 'הראל דנצ׳יקוב', 'ליאב עובד', 'ליאוב', 'גנזיה', 'עילאי גניזה',
  'kozochinski', 'קוזצינסקי', 'shahar ginat', 'שחר גינט']) {
  const hits = M.rankNames(q, R.names, 3, R.aliases);
  console.log(`  ${q.padEnd(18)} → ${hits.map(h => h.name + ' (' + h.score.toFixed(2) + ')').join(', ') || '—'}`);
}

console.log('\n── status for תומר אוסוביצקי');
const who = M.rankNames('tomer osovizky', R.names, 1, R.aliases)[0];
if (who) {
  const st = P.statusFor(R, who.name, NOW);
  console.log('  name:', who.name, '| total shifts:', st.total, '| loc:', R.locations[who.name] || '—');
  st.upcoming.slice(0, 5).forEach(s => console.log('   ', L(s.start), '→', s.end.toLocaleTimeString('he-IL'), '|', s.post, '|', s.tab));
}

console.log('\n── diff simulation (someone gets swapped in)');
const before = R.shifts;
const after = before.filter((_, i) => i !== 5).concat([{ ...before[5], name: 'עידו אס', key: before[5].key.replace(/\|[^|]*$/, '|עידו אס') }]);
const d = P.diff(before, after);
console.log('  added:', d.added.length, 'removed:', d.removed.length, 'people affected:', d.byPerson.map(p => p.name).join(', '));
