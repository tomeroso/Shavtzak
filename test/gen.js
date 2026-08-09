const G = require('../shared/gen.js');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗ ' + m)); };

const people = ['תומר כהן','יוסי לוי','אלון מזרחי','דוד פרץ','ניר אברהם','איתי שרון',
  'עומר ביטון','רועי דהן','שחר גולן','ליאור אזולאי','יונתן חדד','גיא מלכה'];
const posts = ['שער ראשי', { name: 'סיור', per: 2 }, 'עמדה צפונית'];
const r = G.build({ people, posts, start: new Date(2026, 7, 6), days: 4,
  slots: G.slotsEvery('02:00', 4), minRest: 2 });

console.log('slots/day:', G.slotsEvery('02:00', 4).map(s => s.start + '-' + s.end).join(' '));
console.log('assignments:', r.fairness.total, '| per person', r.fairness.min + '-' + r.fairness.max,
            '| nights', r.fairness.nightMin + '-' + r.fairness.nightMax, '| warnings', r.warnings.length);

ok(r.fairness.total === 4 * 6 * 4, 'every slot filled (' + r.fairness.total + ')');
ok(r.fairness.spread <= 1, 'load is even, spread=' + r.fairness.spread);
ok(r.saturated && r.warnings.some(w => w.indexOf('צפוף') >= 0), 'saturated roster is flagged, not silently unfair');

// with even one spare person the rotation frees up and nights should even out
const roomy = G.build({ people: people.concat(['נועם ברק', 'איתן שדה', 'עידו רם']), posts,
  start: new Date(2026, 7, 6), days: 6, slots: G.slotsEvery('02:00', 4), minRest: 2 });
console.log('with 15 people/6 days:', 'per person', roomy.fairness.min + '-' + roomy.fairness.max,
            '| nights', roomy.fairness.nightMin + '-' + roomy.fairness.nightMax,
            '| saturated', roomy.saturated);
ok(!roomy.saturated, 'extra people clear the saturation flag');
ok(roomy.fairness.nightMax - roomy.fairness.nightMin <= 1, 'nights even when there is slack: ' + roomy.fairness.nightMin + '-' + roomy.fairness.nightMax);
ok(roomy.fairness.spread <= 1, 'load still even, spread=' + roomy.fairness.spread);

// nobody in two places at once
const bySlot = {};
r.assignments.forEach(a => { const k = a.day + '|' + a.slot.start; (bySlot[k] = bySlot[k] || []).push(a.name); });
ok(Object.values(bySlot).every(v => new Set(v).size === v.length), 'no double-booking');

// minimum rest honoured
const seq = {};
r.assignments.forEach((a, i) => { });
const idx = {};
r.assignments.forEach(a => {
  const gi = a.day * 6 + G.slotsEvery('02:00', 4).findIndex(s => s.start === a.slot.start);
  (idx[a.name] = idx[a.name] || []).push(gi);
});
let minGap = 99;
Object.values(idx).forEach(list => { list.sort((x, y) => x - y); for (let i = 1; i < list.length; i++) minGap = Math.min(minGap, list[i] - list[i - 1]); });
ok(minGap >= 3, 'rest of 2 slots kept (smallest gap ' + minGap + ')');

// deterministic
const r2 = G.build({ people, posts, start: new Date(2026, 7, 6), days: 4, slots: G.slotsEvery('02:00', 4), minRest: 2 });
ok(G.toTSV(r.rows) === G.toTSV(r2.rows), 'same input → same roster');

// too few people must warn, not crash
const tiny = G.build({ people: ['א אחד', 'ב שניים'], posts: ['שער', 'סיור', 'מגדל'], days: 2, slots: G.slotsEvery('00:00', 8), minRest: 2 });
ok(tiny.warnings.length > 0, 'not enough people → warns');
ok(tiny.rows.length > 1, 'still produces a grid');

// the generated grid must parse back through our own parser
require('../shared/match.js');
const P = require('../shared/parse.js');
const back = P.parseGrid({ title: 'generated', values: r.rows }, { now: new Date(2026, 7, 6), tz: 'Asia/Jerusalem' });
console.log('round-trip through the parser:', back.shifts.length, 'shifts,', back.names.length, 'names');
ok(back.names.length === people.length, 'round-trip keeps everyone (' + back.names.length + '/' + people.length + ')');
ok(back.shifts.length === r.fairness.total, 'round-trip keeps every shift');

console.log('\nfirst rows:');
r.rows.slice(0, 4).forEach(row => console.log('  ' + row.join(' | ')));
console.log('\nload:', r.stats.slice(0, 4).map(s => s.name + '=' + s.count + '(' + s.night + ' לילה)').join('  '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
