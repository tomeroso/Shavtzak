/* The in-app שבצ"ק: the model, the compiler, the conflict rules.
   These matter more than the Sheets tests, because here the app is the source
   of truth — nobody can go and look at the "real" roster to check it. */
const P = require('../shared/parse.js');
const G = require('../shared/gen.js');
const N = require('../shared/native.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};
const PEOPLE = ['אבי לוי', 'בן כהן', 'גיל מזרחי', 'דור פרץ', 'הראל שרון', 'ויקטור ביטון',
                'זיו דהן', 'חן גולן', 'טל אזולאי', 'יואב חדד', 'כפיר מלכה', 'לירן נחום'];
const base = () => N.sanitise({
  title: 'בדיקה', people: PEOPLE,
  posts: [{ name: 'שער', per: 1, mode: 'slot' }, { name: 'סיור', per: 2, mode: 'slot' },
          { name: 'מטבח', per: 1, mode: 'daily', start: '07:00', end: '23:59' }],
  days: N.daysFrom('2026-08-06', 5),
  slots: G.slotsEvery('02:00', 4),
});

console.log('\nמודל השבצ״ק הפנימי');

let d = base();
ok('sanitise keeps what it should', d.people.length === 12 && d.posts.length === 3 && d.days.length === 5 && d.slots.length === 6);

const filled = N.autofill(d);
d = filled.doc;
const slotCells = Object.keys(d.cells).filter(k => k.split('|')[1] !== '-1');
ok('autofill fills every slotted place', slotCells.length === 5 * 6 * 2, slotCells.length + ' of ' + (5 * 6 * 2));

const a1 = N.audit(d, { minRest: 1 });
ok('a filled roster has no holes', !a1.issues.some(i => i.kind === 'hole'), (a1.issues[0] || {}).text);
ok('nobody is double-booked', !a1.issues.some(i => i.kind === 'double'));
ok('rest rule is respected', !a1.issues.some(i => i.kind === 'rest'), (a1.issues.find(i => i.kind === 'rest') || {}).text);
/* Watch load and duty load are different things: מטבח is now filled too, and a
   whole-day תורנות is not a shift on the gate. Fairness is judged per kind. */
const slotCount = doc => {
  const n = {};
  Object.entries(doc.cells).forEach(([k, v]) => { if (k.split('|')[1] !== '-1') v.forEach(x => n[x] = (n[x] || 0) + 1); });
  return doc.people.map(p => n[p] || 0);
};
const spread = a => Math.max.apply(null, a) - Math.min.apply(null, a);
ok('watch load is even', spread(slotCount(d)) <= 1, slotCount(d).join(','));
ok('nights are even', a1.fairness.nightMax - a1.fairness.nightMin <= 1, a1.fairness.nightMin + '–' + a1.fairness.nightMax);

/* Times must mean what the sheet-backed ones mean: Asia/Jerusalem wall clock,
   regardless of where the worker happens to run. */
const c = N.compile(d, { tz: 'Asia/Jerusalem' });
const first = c.shifts.find(s => s.p !== 'מטבח');
const inTZ = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
ok('compiled shift starts on a slot boundary', /:00$/.test(inTZ(first.s, 'Asia/Jerusalem')));
ok('compiled shifts are 4h long', (first.e - first.s) === 4 * 3600e3, ((first.e - first.s) / 3600e3) + 'h');
ok('every shift has a name and a post', c.shifts.every(s => s.n && s.p && s.k));
ok('keys are unique', new Set(c.shifts.map(s => s.k)).size === c.shifts.length);
ok('compile is deterministic', JSON.stringify(N.compile(d).shifts) === JSON.stringify(N.compile(d).shifts));

// daily post: one block a day, its own hours, everyone on it together
d.cells[N.cellKey('2026-08-06', -1, 'מטבח')] = ['אבי לוי', 'בן כהן'];
const c2 = N.compile(d, { tz: 'Asia/Jerusalem' });
const d6 = P.zonedEpoch(2026, 8, 6, 0, 0, 'Asia/Jerusalem');
const d7 = P.zonedEpoch(2026, 8, 7, 0, 0, 'Asia/Jerusalem');
const kitchen = c2.shifts.filter(s => s.p === 'מטבח' && s.s >= d6 && s.s < d7);
ok('daily post produces one shift per person', kitchen.length === 2, kitchen.map(k => k.n).join(','));
ok('daily post uses its own hours', inTZ(kitchen[0].s, 'Asia/Jerusalem') === '07:00', inTZ(kitchen[0].s, 'Asia/Jerusalem'));
ok('daily post is shared, not sequential', kitchen[0].s === kitchen[1].s);
ok('a whole-day duty gets filled automatically too',
   N.daysFrom('2026-08-06', 5).every(x => (d.cells[N.cellKey(x, -1, 'מטבח')] || []).length >= 1),
   JSON.stringify(N.daysFrom('2026-08-06', 5).map(x => (d.cells[N.cellKey(x, -1, 'מטבח')] || []).length)));

// a shift crossing midnight lands on the next day, not backwards
const night = c2.shifts.find(s => inTZ(s.s, 'Asia/Jerusalem') === '22:00');
ok('a 22:00 shift ends after it starts', !night || night.e > night.s);

/* The editor is allowed to produce nonsense; the audit has to say so. */
let bad = base();
bad.cells[N.cellKey('2026-08-06', 0, 'שער')] = ['אבי לוי'];
bad.cells[N.cellKey('2026-08-06', 0, 'סיור')] = ['אבי לוי', 'בן כהן'];
bad.cells[N.cellKey('2026-08-06', 1, 'שער')] = ['אבי לוי'];
bad.unavailable = { 'בן כהן': ['2026-08-06'] };
const a2 = N.audit(bad, { minRest: 1 });
ok('catches the same person twice in one slot', a2.issues.some(i => i.kind === 'double' && i.name === 'אבי לוי'));
ok('catches back-to-back shifts', a2.issues.some(i => i.kind === 'rest' && i.name === 'אבי לוי'));
ok('catches someone rostered on a day off', a2.issues.some(i => i.kind === 'off' && i.name === 'בן כהן'));
ok('catches empty places', a2.issues.some(i => i.kind === 'hole'));

/* Hand placements survive the generator — the whole point of "move people
   around afterwards" is that the app doesn't undo your work behind your back. */
let mixed = base();
mixed.cells[N.cellKey('2026-08-08', 3, 'שער')] = ['לירן נחום'];
mixed.cells[N.cellKey('2026-08-09', 3, 'שער')] = ['לירן נחום'];
const after = N.autofill(mixed).doc;
ok('hand-placed people stay put', after.cells['2026-08-08|3|שער'][0] === 'לירן נחום' &&
   after.cells['2026-08-09|3|שער'][0] === 'לירן נחום');
const lironCount = N.audit(after, { minRest: 1 }).stats.find(s => s.name === 'לירן נחום').count;
const evenish = N.audit(after, { minRest: 1 }).fairness;
ok('the generator schedules around them fairly', evenish.max - evenish.min <= 2, 'spread ' + evenish.min + '–' + evenish.max + ', לירן=' + lironCount);

/* Unavailability is a hard constraint for the filler, not a suggestion. */
let off = base();
off.unavailable = { 'חן גולן': ['2026-08-06', '2026-08-07'] };
const offFilled = N.autofill(off).doc;
const offIssues = N.audit(offFilled, { minRest: 1 }).issues.filter(i => i.kind === 'off');
ok('autofill never rosters someone on a day off', offIssues.length === 0, (offIssues[0] || {}).text);

/* Everything the worker stores has to survive a round trip through sanitise —
   the editor sends the whole document every save. */
const round = N.sanitise(JSON.parse(JSON.stringify(d)));
ok('a saved document round-trips unchanged', JSON.stringify(round.cells) === JSON.stringify(N.sanitise(d).cells));

const junk = N.sanitise({
  title: '   ', people: ['אבי לוי', 'אבי לוי', '', 'x'.repeat(200)],
  posts: [{ name: 'שער', per: 999 }, { name: 'שער', per: 1 }],
  days: ['2026-08-06', 'not-a-date', '2026-08-06'],
  slots: [{ start: '25:00', end: '06:00' }, { start: '02:00', end: '06:00' }],
  cells: { 'bad': ['x'], '2026-08-06|0|שער': ['אבי לוי', 'מי שלא קיים'], '2026-08-06|9|שער': ['אבי לוי'] },
  unavailable: { 'רוח רפאים': ['2026-08-06'] },
});
ok('rejects duplicate, empty and absurdly long names', junk.people.length === 1 && junk.people[0] === 'אבי לוי', junk.people.join('|'));
ok('rejects duplicate posts', junk.posts.length === 1);
ok('caps people per post', junk.posts[0].per === 20);
ok('rejects bad dates and times', junk.days.length === 1 && junk.slots.length === 1);
ok('drops cells that point nowhere', Object.keys(junk.cells).length === 1);
ok('drops names that are not in the roster', junk.cells['2026-08-06|0|שער'].length === 1);
ok('drops unavailability for strangers', Object.keys(junk.unavailable).length === 0);
ok('falls back to a usable title', junk.title === 'שבצ״ק');

/* The whole reason the model exists: what the app shows must come out of the
   same code path as a Google Sheet would. */
const roster = N.compile(d, { tz: 'Asia/Jerusalem' });
const shifts = roster.shifts.map(x => ({ name: x.n, post: x.p, tab: x.t, start: new Date(x.s), end: new Date(x.e), key: x.k }));
const mine = P.shiftsFor({ shifts, aliases: roster.aliases }, 'אבי לוי');
ok('the reader finds a person\'s shifts', mine.length > 0, mine.length + ' shifts');
const st = P.statusFor({ shifts, aliases: roster.aliases }, 'אבי לוי', new Date(shifts[0].start.getTime() + 60000));
ok('"on watch now" works on a native roster', !!st.current || !!st.next);

const changed = JSON.parse(JSON.stringify(d));
const k0 = Object.keys(changed.cells).find(k => k.split('|')[1] !== '-1');
changed.cells[k0] = ['לירן נחום'];
const diff = P.diff(
  N.compile(d).shifts.map(x => ({ key: x.k, name: x.n, post: x.p, tab: x.t, start: new Date(x.s), end: new Date(x.e) })),
  N.compile(changed).shifts.map(x => ({ key: x.k, name: x.n, post: x.p, tab: x.t, start: new Date(x.s), end: new Date(x.e) })));
ok('one swap notifies exactly the people involved', diff.byPerson.length <= 2 && diff.added.length === 1 && diff.removed.length === 1,
   diff.byPerson.map(p => p.name).join(', '));

/* ---- מפקדים וקצינים ---- */
const C = N.sanitiseContacts(N.parseContacts([
  'תומר כהן, מ״פ, 050-1234567',
  'מ״פ אלון מזרחי 0521112222',
  'יוסי לוי | סמ״פ | +972-54-333-4444',
  'חמל 04-9876543',
  'תומר כהן, מ״פ, 050-1234567',
  '   ',
  'בלי מספר בכלל',
].join('\n')));
ok('reads a pasted contact block', C.length === 5, JSON.stringify(C));
ok('finds the number wherever it sits', C[1].name === 'אלון מזרחי' && C[1].role === 'מ״פ' && C[1].phone === '0521112222');
ok('accepts | as a separator too', C[2].role === 'סמ״פ' && C[2].phone === '+972-54-333-4444');
ok('drops an exact duplicate', C.filter(x => x.name === 'תומר כהן').length === 1);
ok('keeps someone with no number', C[4].name === 'בלי מספר בכלל' && !C[4].phone);
ok('round-trips through text', N.contactsToText(N.sanitiseContacts(N.parseContacts(N.contactsToText(C)))) === N.contactsToText(C));
ok('tel: strips punctuation', N.telHref('050-123 4567') === 'tel:0501234567');
ok('rejects a number that is too short to be one', N.sanitiseContacts([{ name: 'x', phone: '123' }])[0].phone === '');
ok('caps the list', N.sanitiseContacts(Array.from({ length: 200 }, (_, i) => ({ name: 'איש ' + i, phone: '05012345' + (i % 10) }))).length === 80);
ok('survives junk', N.sanitiseContacts([null, 5, { name: 'x'.repeat(300), role: 'y'.repeat(300), phone: '<script>050-1234567' }]).length === 1);

/* ---- כרמל א: a whole day in gear, and therefore no watches ---- */
{
  const K = () => N.sanitise({
    title: 'כוננות', people: PEOPLE.concat(['מיכל אבן', 'נדב שור', 'סער טל', 'עידן רם']),
    posts: [
      { name: 'שער', per: 1, mode: 'slot' },
      { name: 'סיור', per: 2, mode: 'slot' },
      { name: 'כרמל א', per: 4, mode: 'daily', start: '00:00', end: '23:59', exempt: true },
      { name: 'כרמל ב', mode: 'daily', start: '00:00', end: '23:59', from: { posts: ['סיור', 'שער'], at: '02:00' } },
    ],
    days: N.daysFrom('2026-08-10', 4), slots: G.slotsEvery('02:00', 4),
  });
  const r = N.autofill(K());
  const doc = r.doc;

  const standby = doc.days.map(x => (doc.cells[N.cellKey(x, -1, 'כרמל א')] || []).length);
  ok('כרמל א is filled, four a day', standby.every(n => n === 4), standby.join(','));

  const a = N.audit(doc, {});
  ok('nobody on כרמל א takes a watch that day', !a.issues.some(i => i.kind === 'exempt'),
     (a.issues.find(i => i.kind === 'exempt') || {}).text);

  // and the audit catches it when a human does it by hand
  const broken = JSON.parse(JSON.stringify(doc));
  const who = broken.cells[N.cellKey('2026-08-10', -1, 'כרמל א')][0];
  broken.cells[N.cellKey('2026-08-10', 2, 'שער')] = [who];
  const ab = N.audit(broken, {});
  ok('and says so when someone does it by hand',
     ab.issues.some(i => i.kind === 'exempt' && i.name === who),
     (ab.issues.find(i => i.kind === 'exempt') || {}).text);

  // כרמל ב is whoever came off at 02:00 — the 22:00 crew of the day before
  const prevNight = ['סיור', 'שער'].flatMap(p => doc.cells[N.cellKey('2026-08-10', 5, p)] || []);
  const carmelB = doc.cells[N.cellKey('2026-08-11', -1, 'כרמל ב')] || [];
  ok('כרמל ב is the crew that just came off', prevNight.length > 0 &&
     prevNight.every(n => carmelB.indexOf(n) >= 0) && carmelB.length === prevNight.length,
     'off=' + prevNight.join(',') + '  ב=' + carmelB.join(','));

  // it is the rule's output, so it follows the roster rather than being typed
  const moved = JSON.parse(JSON.stringify(doc));
  moved.cells[N.cellKey('2026-08-10', 5, 'שער')] = ['לירן נחום'];
  const after2 = N.applyFrom(moved);
  ok('and it re-follows the roster when the watch changes',
     (after2.cells[N.cellKey('2026-08-11', -1, 'כרמל ב')] || []).indexOf('לירן נחום') >= 0,
     JSON.stringify(after2.cells[N.cellKey('2026-08-11', -1, 'כרמל ב')]));

  ok('a fed column is never reported as short of people',
     !N.audit(doc, {}).issues.some(i => i.kind === 'hole' && i.post === 'כרמל ב'));

  // a post cannot be fed by itself
  const loop = N.sanitise({ title: 'x', people: PEOPLE, days: N.daysFrom('2026-08-10', 1),
    slots: G.slotsEvery('02:00', 4),
    posts: [{ name: 'א', mode: 'daily', from: { posts: ['א'], at: '02:00' } }] });
  ok('a post cannot feed itself', !loop.posts[0].from);
}

/* ---- rest is chosen, not configured ---- */
{
  const many = N.sanitise({ title: 'many', people: PEOPLE.concat(['מ1 x', 'מ2 x', 'מ3 x', 'מ4 x', 'מ5 x', 'מ6 x']),
    posts: [{ name: 'שער', per: 1, mode: 'slot' }],
    days: N.daysFrom('2026-08-10', 3), slots: G.slotsEvery('02:00', 4) });
  const rm = N.autofill(many);
  ok('with plenty of people it takes a long rest', rm.minRest >= 5, 'rest=' + rm.minRest);
  ok('and says what it chose', (rm.warnings[0] || '').indexOf('מנוחה בין שמירות') === 0, rm.warnings[0]);

  const few = N.sanitise({ title: 'few', people: PEOPLE.slice(0, 4),
    posts: [{ name: 'שער', per: 1, mode: 'slot' }, { name: 'סיור', per: 2, mode: 'slot' }],
    days: N.daysFrom('2026-08-10', 3), slots: G.slotsEvery('02:00', 4) });
  const rf = N.autofill(few);
  ok('with barely enough people it drops to what fits', rf.minRest === 0, 'rest=' + rf.minRest);
  const holes = N.audit(rf.doc, {}).issues.filter(i => i.kind === 'hole');
  ok('and still fills every place', holes.length === 0, holes.length + ' holes');
}

/* ---- a whole-day post that turns over during the day ---- */
{
  const mk = segs => N.sanitise({
    title: 'turnover', people: PEOPLE.concat(['מיכל אבן', 'נדב שור', 'סער טל', 'עידן רם', 'פז ניר', 'צחי בר', 'קרן דגן', 'רועי שם']),
    posts: [{ name: 'שג', per: 1, mode: 'slot' }, { name: 'סיור', per: 2, mode: 'slot' },
            { name: 'כרמל א', per: 4, mode: 'daily', start: '00:00', end: '23:59', exempt: true }],
    days: N.daysFrom('2026-08-10', 3), slots: G.slotsEvery('02:00', 4), segs,
  });

  const one = N.autofill(mk({})).doc;
  ok('with no split it is one block a day',
     N.segsFor(one, '2026-08-10', one.posts[2]).length === 1);

  const two = N.autofill(mk({ '2026-08-11|כרמל א': [{ start: '00:00', end: '12:00' }, { start: '12:00', end: '23:59' }] })).doc;
  const post = two.posts.find(p => p.name === 'כרמל א');
  const segs = N.segsFor(two, '2026-08-11', post);
  const a = two.cells[N.cellKey('2026-08-11', N.segSlot(0), 'כרמל א')] || [];
  const b = two.cells[N.cellKey('2026-08-11', N.segSlot(1), 'כרמל א')] || [];
  ok('a split day has two blocks', segs.length === 2 && segs[1].start === '12:00');
  ok('each block gets its own four', a.length === 4 && b.length === 4, a.length + '+' + b.length);
  ok('and they are different people', a.every(n => b.indexOf(n) < 0), a.join(',') + ' vs ' + b.join(','));
  ok('an unsplit day is still one crew',
     (two.cells[N.cellKey('2026-08-10', N.segSlot(1), 'כרמל א')] || []).length === 0);

  const au = N.audit(two, {});
  ok('everybody on either block is off watches that day', !au.issues.some(i => i.kind === 'exempt'),
     (au.issues.find(i => i.kind === 'exempt') || {}).text);
  ok('no holes across the split', !au.issues.some(i => i.kind === 'hole'),
     (au.issues.find(i => i.kind === 'hole') || {}).text);

  const c = N.compile(two, { tz: 'Asia/Jerusalem' });
  const day2 = c.shifts.filter(s => s.p === 'כרמל א' && inTZ(s.s, 'Asia/Jerusalem') !== '00:00' ? false : true);
  const noon = c.shifts.filter(s => s.p === 'כרמל א' && inTZ(s.s, 'Asia/Jerusalem') === '12:00');
  ok('the second block compiles to its own hours', noon.length === 4, noon.length + ' shifts at 12:00');
  const first = c.shifts.filter(s => s.p === 'כרמל א' && inTZ(s.e, 'Asia/Jerusalem') === '12:00');
  ok('and the first one ends where it starts', first.length === 4, first.length);

  // a short block still counts as short
  const gappy = mk({ '2026-08-11|כרמל א': [{ start: '00:00', end: '08:00' }, { start: '08:00', end: '23:59' }] });
  gappy.cells[N.cellKey('2026-08-11', N.segSlot(1), 'כרמל א')] = ['אבי לוי'];
  const ag = N.audit(gappy, {});
  ok('a half-empty block is reported', ag.issues.some(i => i.kind === 'hole' && /08:00/.test(i.text)),
     (ag.issues.find(i => i.kind === 'hole') || {}).text);

  // rubbish segments are dropped, not stored
  const junk2 = N.sanitise(Object.assign(mk({}), { segs: {
    '2026-08-11|כרמל א': [{ start: '99:99', end: 'x' }, { start: '06:00', end: '18:00' }],
    '2026-08-11|לא קיים': [{ start: '06:00', end: '18:00' }],
    'not-a-day|כרמל א': [{ start: '06:00', end: '18:00' }],
  } }));
  ok('bad segments are thrown away', Object.keys(junk2.segs).length === 1 &&
     junk2.segs['2026-08-11|כרמל א'].length === 1, JSON.stringify(junk2.segs));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
