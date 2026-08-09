/* Layout shapes we have no sample of — the ones another unit's sheet might use. */
require('../shared/match.js');
const P = require('../shared/parse.js');
// Everything is asserted in Israel time, so these pass no matter what TZ the
// runtime is in — which is the property the parser now guarantees.
const TZ = 'Asia/Jerusalem';
const NOW = new Date('2026-08-05T12:30:00Z');            // 15:30 in Israel
const ymd = d => d.toLocaleDateString('he-IL', { timeZone: TZ });
const hour = d => +d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
let pass = 0, fail = 0;

function check(title, values, expect) {
  const r = P.parseGrid({ title, values }, { now: NOW });
  const days = [...new Set(r.shifts.map(s => ymd(s.start)))];
  const ok = r.shifts.length >= expect.min &&
    (!expect.day || days.includes(expect.day)) &&
    (!expect.name || r.shifts.some(s => s.name === expect.name)) &&
    (!expect.post || r.shifts.some(s => s.post === expect.post)) &&
    (!expect.hour || r.shifts.some(s => hour(s.start) === expect.hour));
  console.log(`${ok ? '  ✓' : '  ✗'} ${title}: ${r.shifts.length} shifts, days=[${days.join(', ')}], axis=${r.diag.colAxis}${r.diag.transposed ? ' (transposed)' : ''}`);
  if (!ok) { fail++; console.log('     diag:', JSON.stringify(r.diag), r.warnings); }
  else pass++;
}

/* 1. dates ACROSS the top, times down the side — the classic shape */
check('dates across the top', [
  ['שבצ״ק שמירות'],
  ['שעה', '5.8', '6.8', '7.8'],
  ['06:00-10:00', 'תומר כהן', 'יוסי לוי', 'ניר אברהם'],
  ['10:00-14:00', 'יוסי לוי', 'ניר אברהם', 'תומר כהן'],
  ['22:00-02:00', 'ניר אברהם', 'תומר כהן', 'יוסי לוי'],
], { min: 9, day: '6.8.2026', name: 'תומר כהן', hour: 22 });

/* 2. same, plus section rows naming the post */
check('dates across + post sections', [
  ['שעה', '5.8', '6.8'],
  ['שער ראשי'],
  ['06:00-10:00', 'תומר כהן', 'יוסי לוי'],
  ['14:00-18:00', 'יוסי לוי', 'תומר כהן'],
  ['עמדה צפונית'],
  ['06:00-10:00', 'ניר אברהם', 'דוד פרץ'],
], { min: 6, day: '6.8.2026', post: 'עמדה צפונית' });

/* 3. transposed: times across the top, posts down the side, date in the title */
check('transposed, times across the top', [
  ['שבצ״ק 6.8'],
  ['עמדה', '06:00-10:00', '10:00-14:00', '14:00-18:00'],
  ['שער ראשי', 'תומר כהן', 'יוסי לוי', 'ניר אברהם'],
  ['סיור', 'דוד פרץ', 'שחר גולן', 'ליאור אזולאי'],
], { min: 6, day: '6.8.2026', post: 'שער ראשי' });

/* 4. single day, no date anywhere — should still work, with a warning */
check('no date at all', [
  ['שעה', 'שער', 'סיור'],
  ['08:00-12:00', 'תומר כהן', 'יוסי לוי'],
  ['12:00-16:00', 'יוסי לוי', 'תומר כהן'],
], { min: 4, day: '5.8.2026' });

/* 5. compact and dotted time formats, dd/mm/yy dates */
check('odd time and date formats', [
  ['תאריך', 'שעות', 'עמדה', 'שם'],
  ['06/08/26', '0800-1600', 'שער', 'תומר כהן'],
  ['06/08/26', '16.00-23.30', 'שער', 'יוסי לוי'],
  ['07/08/26', '8-16', 'סיור', 'ניר אברהם'],
], { min: 3, day: '6.8.2026', hour: 8 });

/* 6. English sheet */
check('english headers', [
  ['Date', 'Time', 'Post', 'Name'],
  ['5.8', '08:00-16:00', 'Main gate', 'Tomer Cohen'],
  ['5.8', '16:00-00:00', 'Main gate', 'Yossi Levi'],
], { min: 2, name: 'Tomer Cohen' });

/* 7. merged day cells (what the Sheets API gives us) */
{
  const values = [
    ['יום', 'שעה', 'שער', 'סיור'],
    ['ד 6.8', '06:00-10:00', 'תומר כהן', 'יוסי לוי'],
    ['', '10:00-14:00', 'ניר אברהם', 'דוד פרץ'],
    ['', '14:00-18:00', 'שחר גולן', 'תומר כהן'],
    ['ה 7.8', '06:00-10:00', 'יוסי לוי', 'ניר אברהם'],
  ];
  const merges = [{ r: 1, c: 0, rs: 3, cs: 1 }];
  const r = P.parseGrid({ title: 'merged days', values, merges }, { now: NOW });
  const days = [...new Set(r.shifts.map(s => ymd(s.start)))];
  const ok = r.shifts.length === 8 && days.length === 2 && days.includes('6.8.2026');
  console.log(`${ok ? '  ✓' : '  ✗'} merged day column: ${r.shifts.length} shifts across ${days.join(', ')}`);
  ok ? pass++ : fail++;
}

/* 8. an all-day merged assignment spanning every slot */
{
  const values = [
    ['יום', 'שעה', 'שער', 'קצין מוצב'],
    ['ד 6.8', '06:00-10:00', 'תומר כהן', 'ליאב עובד'],
    ['ד 6.8', '10:00-14:00', 'ניר אברהם', ''],
    ['ד 6.8', '14:00-18:00', 'שחר גולן', ''],
  ];
  const merges = [{ r: 1, c: 3, rs: 3, cs: 1 }];
  const r = P.parseGrid({ title: 'all-day officer', values, merges }, { now: NOW });
  const liav = r.shifts.filter(s => s.name === 'ליאב עובד');
  const ok = liav.length === 3;
  console.log(`${ok ? '  ✓' : '  ✗'} merged all-day cell: ליאב עובד got ${liav.length}/3 slots`);
  ok ? pass++ : fail++;
}

/* 9. junk that must not become people */
{
  const r = P.parseGrid({
    title: 'junk', values: [
      ['יום', 'שעה', 'שער', 'סיור', 'הערות'],
      ['5.8', '06:00-10:00', 'תומר כהן', '-', 'סיור יורד'],
      ['5.8', '10:00-14:00', 'X', 'יוסי לוי', '10-22'],
      ['5.8', '14:00-18:00', 'חופש', 'ניר אברהם', ''],
    ]
  }, { now: NOW });
  const bad = r.names.filter(n => /^(x|-|חופש|10-22|סיור יורד)$/i.test(n));
  const ok = !bad.length && r.names.length === 3;
  console.log(`${ok ? '  ✓' : '  ✗'} junk rejected: names=[${r.names.join(', ')}]`);
  ok ? pass++ : fail++;
}

/* 10. a tab with nothing schedule-like must fail loudly, not silently */
{
  const r = P.parseGrid({ title: 'notes', values: [['הערות'], ['לזכור להביא מים'], ['הרמטכ״ל מגיע']] }, { now: NOW });
  const ok = r.shifts.length === 0 && r.warnings.length > 0 && !!r.diag.reason;
  console.log(`${ok ? '  ✓' : '  ✗'} non-schedule tab reports why: "${r.diag.reason}"`);
  ok ? pass++ : fail++;
}

/* 11. the same sheet must produce identical instants in any runtime timezone */
{
  const vals = [['יום', 'שעה', 'שער'], ['ג 6.8', '22:00-02:00', 'תומר כהן'], ['ג 6.8', '10:00-14:00', 'יוסי לוי']];
  const sig = P.parseGrid({ title: 'tz', values: vals }, { now: NOW })
    .shifts.map(s => +s.start + '/' + +s.end).join(',');
  const expected = '1785999600000/1786014000000,1786042800000/1786057200000';  // 6.8 10:00-14:00 and 22:00-02:00 Israel time
  const ok = sig === expected;
  console.log(`${ok ? '  ✓' : '  ✗'} timezone invariant (runtime TZ=${process.env.TZ || 'system'}): ${ok ? 'instants match Israel time' : sig}`);
  ok ? pass++ : fail++;
}

/* 12. a post that runs its own hours, written inside the cell.
   חמל / כוננות usually do 8-hour shifts while the guard posts do 4, so the
   sheet states the hours next to the name. The column used to be mistaken for
   a second time axis and dropped whole — the post vanished with no warning. */
check('a post that carries its own hours', [
  ['יום', 'שעה', 'שער ראשי', 'חמל'],
  ['ה 6.8', '02:00-06:00', 'תומר כהן', '08:00-16:00 יוסי לוי'],
  ['', '06:00-10:00', 'ניר אברהם', '16:00-24:00 איתי שרון'],
  ['', '10:00-14:00', 'שחר גולן', '00:00-08:00 אלון מזרחי'],
  ['ו 7.8', '02:00-06:00', 'יוסי לוי', '08:00-16:00 תומר כהן'],
  ['', '06:00-10:00', 'איתי שרון', '16:00-24:00 ניר אברהם'],
], { min: 10, post: 'חמל', name: 'יוסי לוי' });

{
  const r = P.parseGrid({ title: 'own hours', values: [
    ['יום', 'שעה', 'שער ראשי', 'חמל'],
    ['ה 6.8', '02:00-06:00', 'תומר כהן', '08:00-16:00 יוסי לוי'],
    ['', '06:00-10:00', 'ניר אברהם', '16:00-24:00 איתי שרון'],
  ] }, { now: NOW });
  const hm = d => d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const h = r.shifts.find(s => s.post === 'חמל');
  const good = h && hm(h.start) === '08:00' && hm(h.end) === '16:00' && h.name === 'יוסי לוי';
  console.log((good ? '  ✓' : '  ✗') + ' the stated hours win over the row\'s: ' +
    (h ? h.name + ' ' + hm(h.start) + '-' + hm(h.end) : 'no חמל shift'));
  good ? pass++ : fail++;
}

/* a number range that is not a time must stay part of the name */
{
  const rows = [['יום', 'שעה', 'שער', 'כיתה']];
  [['ה 6.8', '02:00-06:00'], ['', '06:00-10:00'], ['ו 7.8', '02:00-06:00'],
   ['', '06:00-10:00'], ['ש 8.8', '02:00-06:00'], ['', '06:00-10:00']]
    .forEach(([d, t], i) => rows.push([d, t, 'איש ' + i, 'כיתה ' + (i + 1) + '-' + (i + 2) + ' יוסי לוי']));
  const r = P.parseGrid({ title: 'not a time', values: rows }, { now: NOW });
  const k = r.shifts.filter(s => s.post === 'כיתה');
  const good = k.length === 6 && hour(k[0].start) === 2;
  console.log((good ? '  ✓' : '  ✗') + ' "כיתה 3-4" is a name, not hours: ' + k.length + ' shifts');
  good ? pass++ : fail++;
}

/* a column that reads fine but produces nothing must say so out loud */
{
  const r = P.parseGrid({ title: 'dead column', values: [
    ['יום', 'שעה', 'שער ראשי', 'חמל'],
    ['ה 6.8', '02:00-06:00', 'תומר כהן', ''],
    ['', '06:00-10:00', 'ניר אברהם', ''],
    ['ו 7.8', '02:00-06:00', 'יוסי לוי', ''],
  ] }, { now: NOW });
  const named = (r.warnings || []).some(w => w.indexOf('חמל') >= 0);
  const listed = (r.diag.columns || []).some(c => c.name === 'חמל' && c.n === 0);
  console.log((named && listed ? '  ✓' : '  ✗') + ' an empty column is reported by name: ' +
    JSON.stringify(r.warnings));
  (named && listed) ? pass++ : fail++;
}

/* 13. hours written INSIDE the post column, as markers above the names.
   Straight from a real שבצ״ק: the חמ״ל does two 12-hour blocks a day while the
   guard posts do four-hour slots, so the column carries its own clock. Before,
   "10-22" made the whole column look like a second time axis and it was thrown
   away — the post produced nothing at all, with no warning. */
{
  const r = P.parseGrid({ title: 'in-column hours', values: [
    ['יום', 'שעה', 'שער', 'חמ״ל'],
    ['ג 4/8', '02:00-06:00', 'אבי לוי', 'עילאי דוידי'],
    ['', '06:00-10:00', 'בן כהן', '10-22'],
    ['', '10:00-14:00', 'גיל מזרחי', 'עילאי גניזה'],
    ['', '14:00-18:00', 'דור פרץ', 'גלעד אפריים'],
    ['', '18:00-22:00', 'הראל שרון', '22-10'],
    ['', '22:00-02:00', 'זיו דהן', 'תמיר לויצקי'],
    ['ד 5/8', '02:00-06:00', 'אבי לוי', 'יובל רגב'],
    ['', '10:00-14:00', 'בן כהן', '10-22'],
    ['', '14:00-18:00', 'גיל מזרחי', 'עילאי גניזה'],
  ] }, { now: NOW });
  const hm = d => d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const h = r.shifts.filter(s => s.post === 'חמ״ל');
  const g = h.find(s => s.name === 'עילאי גניזה' && ymd(s.start) === '4.8.2026');
  const t = h.find(s => s.name === 'תמיר לויצקי');
  const a = h.find(s => s.name === 'גלעד אפריים');
  const shared = g && a && +g.start === +a.start;                  // both on the same block
  const good = h.length >= 6 &&
    g && hm(g.start) === '10:00' && hm(g.end) === '22:00' &&
    t && hm(t.start) === '22:00' && hm(t.end) === '10:00' &&
    +t.end > +t.start &&                                            // crosses midnight forwards
    shared;
  console.log((good ? '  ✓' : '  ✗') + ' hours written in the column govern the names below: ' +
    h.map(s => s.name + ' ' + hm(s.start) + '-' + hm(s.end)).join(' | '));
  good ? pass++ : fail++;
}

/* a marker must not leak into the next day */
{
  const r = P.parseGrid({ title: 'marker resets', values: [
    ['יום', 'שעה', 'שער', 'חמ״ל'],
    ['ג 4/8', '02:00-06:00', 'אבי לוי', '10-22'],
    ['', '06:00-10:00', 'בן כהן', 'עילאי גניזה'],
    ['ד 5/8', '02:00-06:00', 'גיל מזרחי', 'תמיר לויצקי'],
  ] }, { now: NOW });
  const hm = d => d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
  const t = r.shifts.find(s => s.name === 'תמיר לויצקי');
  const good = t && hm(t.start) === '02';
  console.log((good ? '  ✓' : '  ✗') + ' the marker is forgotten at the next day: ' +
    (t ? 'תמיר at ' + hm(t.start) : 'missing'));
  good ? pass++ : fail++;
}

/* 14. a row that names its own day inside a block labelled with another one.
   "מוצ״ש (20:30-22:00)" listed under the שישי block is Saturday night. It used
   to inherit the block's Friday, so the shift showed up a day early — and on a
   Friday that means the app skips tomorrow entirely. */
{
  const FRI = new Date('2026-08-07T09:00:00Z');          // Friday, 12:00 in Israel
  const r = P.parseGrid({ title: 'weekly', values: [
    ['ראשון עד חמישי', 'חפקים', 'סיור'],
    ['בוקר (06:00-08:00)', 'פטרול', 'עיקולי פחמה'],
    ['שישי', 'חפקים', 'סיור'],
    ['בוקר (06:00-08:00)', '', 'פטרול'],
    ['מוצ״ש (20:30-22:00)', 'פטרול', 'עיקולי פחמה'],
  ] }, { now: FRI, tz: TZ });
  const wd = d => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
  const motzash = r.shifts.filter(s => hour(s.start) === 20).sort((a, b) => a.start - b.start)[0];
  const sunday = r.shifts.filter(s => wd(s.start) === 'Sun' && hour(s.start) === 6)[0];
  const good = motzash && wd(motzash.start) === 'Sat' && ymd(motzash.start) === '8.8.2026' && !!sunday;
  console.log((good ? '  ✓' : '  ✗') + ' מוצ״ש lands on Saturday, not on the block\'s Friday: ' +
    (motzash ? wd(motzash.start) + ' ' + ymd(motzash.start) : 'missing'));
  good ? pass++ : fail++;
}

/* the block still rules rows that say nothing about a day */
{
  const FRI = new Date('2026-08-07T09:00:00Z');
  const r = P.parseGrid({ title: 'block wins', values: [
    ['שישי', 'חפקים'],
    ['בוקר (06:00-08:00)', 'פטרול'],
    ['ערב (19:00-20:30)', 'פטרול'],
  ] }, { now: FRI, tz: TZ });
  const wd = d => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
  const good = r.shifts.length >= 2 && r.shifts.every(s => wd(s.start) === 'Fri');
  console.log((good ? '  ✓' : '  ✗') + ' rows with no day of their own follow the block: ' +
    [...new Set(r.shifts.map(s => wd(s.start)))].join(','));
  good ? pass++ : fail++;
}

/* 15. a block that spans two days, written as one range.
   "ש 8-9.8" is Saturday–Sunday, 8–9 August. Read as a plain date it becomes
   "the 8th of the 9th" — a month away, and on a Tuesday. That is exactly what
   a real user saw: "אתה פנוי · 31 ימים" with a next shift on יום שלישי 8.9,
   while the actual weekend shift sat two days ahead. */
{
  const NOW2 = new Date('2026-08-07T09:00:00Z');
  const d = P.findDate('ש 8-9.8', NOW2);
  const good = d && d.d === 8 && d.mo === 8 && d.y === 2026;
  console.log((good ? '  ✓' : '  ✗') + ' "ש 8-9.8" is 8 August, not 8 September: ' +
    (d ? d.d + '.' + d.mo + '.' + d.y : 'null'));
  good ? pass++ : fail++;

  const cases = [
    ['8-9.8', 8, 8], ['ש 8-9/8', 8, 8], ['8-9.8.26', 8, 8], ['סופ״ש 8-9.8', 8, 8],
    ['31.8-1.9', 31, 8], ['30-1.9', 30, 8],           // the 30th belongs to the month before
    ['ש 8.8', 8, 8], ['א 9/8', 9, 8], ['ג 11/8', 11, 8], ['2026-08-08', 8, 8], ['6.8.26', 6, 8],
  ];
  let allOk = true;
  for (const [str, dd, mm] of cases) {
    const x = P.findDate(str, NOW2);
    if (!x || x.d !== dd || x.mo !== mm) { allOk = false; console.log('     ✗ ' + str + ' → ' + JSON.stringify(x)); }
  }
  console.log((allOk ? '  ✓' : '  ✗') + ' every other date format still reads the same');
  allOk ? pass++ : fail++;

  // things that only look like dates
  const notDates = ['כיתה 3-4', '10-22', '3-4', '02:00-06:00', '8.00-9.00'];
  const clean = notDates.every(x => P.findDate(x, NOW2) === null);
  console.log((clean ? '  ✓' : '  ✗') + ' a bare hyphen pair is not a date: ' +
    notDates.map(x => x + '=' + JSON.stringify(P.findDate(x, NOW2))).join(' '));
  clean ? pass++ : fail++;
}

/* end to end: a weekend block dated by a range puts the shift on the right day */
{
  const NOW2 = new Date('2026-08-07T09:00:00Z');            // Friday
  const r = P.parseGrid({ title: 'weekend block', values: [
    ['יום', 'שעה', 'שג', 'ש״ג אחורי'],
    ['ו 7.8', '02:00-06:00', 'אבי לוי', 'בן כהן'],
    ['ש 8-9.8', '02:00-06:00', 'תומר אוסוביצקי', 'גיל מזרחי'],
    ['', '14:00-18:00', 'דור פרץ', 'תומר אוסוביצקי'],
  ] }, { now: NOW2, tz: TZ });
  const mine = r.shifts.filter(s => s.name === 'תומר אוסוביצקי').sort((a, b) => a.start - b.start);
  const good = mine.length === 2 && ymd(mine[0].start) === '8.8.2026';
  console.log((good ? '  ✓' : '  ✗') + ' the weekend block lands on 8.8, two days out — not 8.9: ' +
    mine.map(s => ymd(s.start)).join(', '));
  good ? pass++ : fail++;
}

/* 16. the day letter as a checksum on the numbers beside it.
   Real cell, from a real שבצ״ק: "ש 8/9" — Saturday, the 8th–9th of August.
   Read as day-and-month it is 8 September, which is a Tuesday, a month out and
   on the wrong day. The letter is free evidence and it wins. */
{
  const FRI = new Date('2026-08-07T09:00:00Z');
  const r = P.parseGrid({ title: 'day letter wins', values: [
    ['יום', 'שעה', 'שג', 'ש״ג אחורי'],
    ['ג 4/8', '02:00-06:00', 'אבי לוי', 'בן כהן'],
    ['ו 7/8', '02:00-06:00', 'גיל מזרחי', 'דור פרץ'],
    ['ש 8/9', '02:00-06:00', 'תומר אוסוביצקי', 'הראל שרון'],
    ['', '22:00-02:00', 'זיו דהן', 'תומר אוסוביצקי'],
    ['א 9/8', '02:00-06:00', 'חן גולן', 'טל אזולאי'],
  ] }, { now: FRI, tz: TZ });
  const wd = d => d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
  const sat = r.shifts.filter(s => ymd(s.start) === '8.8.2026');
  const sun = r.shifts.filter(s => ymd(s.start) === '9.8.2026');
  const tue = r.shifts.filter(s => ymd(s.start) === '4.8.2026');
  const late = sat.find(s => hour(s.start) === 22);
  const good = sat.length === 4 && sun.length === 2 && tue.length === 2 &&
    wd(sat[0].start) === 'Sat' &&
    late && ymd(late.end) === '9.8.2026';          // 22:00–02:00 ends on the 9th
  console.log((good ? '  ✓' : '  ✗') + ' "ש 8/9" is Saturday 8 August, not 8 September: ' +
    [...new Set(r.shifts.map(s => wd(s.start) + ' ' + ymd(s.start)))].join(' | '));
  good ? pass++ : fail++;

  const said = (r.warnings || []).some(w => w.indexOf('8/9') >= 0);
  console.log((said ? '  ✓' : '  ✗') + ' and it says out loud that it reinterpreted the cell');
  said ? pass++ : fail++;
}

/* it must never slide a roster into another year to make a letter fit */
{
  const r = P.parseGrid({ title: 'wrong letter', values: [
    ['יום', 'שעה', 'שער'],
    ['ד 6.8', '06:00-10:00', 'תומר כהן'],       // 6.8.2026 is a Thursday, not ד
    ['', '10:00-14:00', 'ניר אברהם'],
  ] }, { now: NOW });
  const years = [...new Set(r.shifts.map(s => s.start.getFullYear()))];
  const good = years.length === 1 && years[0] === 2026;
  console.log((good ? '  ✓' : '  ✗') + ' a letter that simply disagrees leaves the year alone: ' + years.join(','));
  good ? pass++ : fail++;
}

/* 17. wide sheets repeat יום / שעה on the far side so you can read the right-hand
   columns without scrolling back. The copy must not become a post named "יום"
   whose people are "ג 4" and "ד 5". */
{
  const r = P.parseGrid({ title: 'mirrored key columns', values: [
    ['יום', 'שעה', 'שער', 'סיור', 'יום', 'שעה'],
    ['ג 4.8', '02:00-06:00', 'אבי לוי', 'בן כהן', 'ג 4.8', '02:00-06:00'],
    ['', '06:00-10:00', 'גיל מזרחי', 'דור פרץ', '', '06:00-10:00'],
    ['ד 5.8', '02:00-06:00', 'הראל שרון', 'זיו דהן', 'ד 5.8', '02:00-06:00'],
  ] }, { now: NOW });
  const posts = [...new Set(r.shifts.map(s => s.post))];
  const good = posts.length === 2 && posts.indexOf('יום') < 0 && posts.indexOf('שעה') < 0 &&
    r.shifts.length === 6;
  console.log((good ? '  ✓' : '  ✗') + ' a repeated יום/שעה pair stays a key column: posts=' + posts.join(','));
  good ? pass++ : fail++;
}

/* 18. a whole-day duty on a two-day block runs on both days.
   "on Saturday kitchen is for both days" — the slot rows under ש 8/9 are one
   24-hour cycle and belong to the 8th, but מטבח covers the 8th and the 9th. */
{
  const FRI = new Date('2026-08-07T09:00:00Z');
  const RULES = { [P.normKey('מטבח')]: { mode: 'daily', start: '07:00', end: '23:59', label: 'מטבח' } };
  const r = P.parseGrid({ title: 'two-day kitchen', values: [
    ['יום', 'שעה', 'מטבח', 'שג'],
    ['ו 7/8', '02:00-06:00', 'אבי לוי', 'בן כהן'],
    ['ש 8/9', '02:00-06:00', 'גיל מזרחי', 'דור פרץ'],
    ['', '14:00-18:00', '', 'הראל שרון'],
    ['ב 10/8', '02:00-06:00', 'חן גולן', 'טל אזולאי'],
  ] }, { now: FRI, tz: TZ, rules: RULES });
  const kitchen = r.shifts.filter(s => s.post === 'מטבח').sort((a, b) => a.start - b.start);
  const gil = kitchen.filter(s => s.name === 'גיל מזרחי').map(s => ymd(s.start));
  const guard = r.shifts.filter(s => s.post === 'שג').map(s => ymd(s.start));
  const good = gil.length === 2 && gil[0] === '8.8.2026' && gil[1] === '9.8.2026' &&
    guard.indexOf('9.8.2026') < 0 &&              // the slot rows stay on the 8th
    hour(kitchen[0].start) === 7;
  console.log((good ? '  ✓' : '  ✗') + ' מטבח covers both days of ש 8/9, the guard slots do not: ' +
    'מטבח=' + gil.join(',') + '  שג=' + [...new Set(guard)].join(','));
  good ? pass++ : fail++;

  const single = r.shifts.filter(s => s.post === 'מטבח' && s.name === 'חן גולן');
  console.log((single.length === 1 ? '  ✓' : '  ✗') + ' an ordinary day still gets one whole-day block');
  single.length === 1 ? pass++ : fail++;
}

/* 19. a cell that names another post instead of a person.
   "סיור יורד + מכולות יורד" — whoever just came off סיור, plus whoever just
   came off מכולות. Left alone it becomes a person by that name who is on watch
   forever; resolved, it follows the roster automatically. */
{
  const FRI = new Date('2026-08-07T09:00:00Z');
  const r = P.parseGrid({ title: 'derived', values: [
    ['יום', 'שעה', 'סיור', 'מכולות', 'כרמל ב', 'כרמל א'],
    ['ג 4/8', '06:00-10:00', 'רוטשטיין, יואב, יכ״צ', 'דנה כהן', '', ''],
    ['', '10:00-14:00', 'שחר גינת', 'רון לוי', 'סיור יורד + מכולות יורד', 'מ״כ סיור יורד'],
    ['', '14:00-18:00', 'עידו גרוסמן', '', 'סיור עולה', ''],
  ] }, { now: FRI, tz: TZ });
  const namesOn = post => r.shifts.filter(s => s.post === post).map(s => s.name);
  const b = namesOn('כרמל ב'), a = namesOn('כרמל א');
  const good = b.indexOf('רוטשטיין') >= 0 && b.indexOf('יואב') >= 0 && b.indexOf('דנה כהן') >= 0 &&
    a.length === 1 && a[0] === 'רוטשטיין' &&                       // מ״כ takes the first listed
    !r.shifts.some(s => /יורד|עולה/.test(s.name));                 // and no ghost person survives
  console.log((good ? '  ✓' : '  ✗') + ' "סיור יורד" resolves to the outgoing crew: כרמל ב=' +
    b.join(',') + '  כרמל א=' + a.join(','));
  good ? pass++ : fail++;

  const up = r.shifts.filter(s => s.post === 'כרמל ב' && hour(s.start) === 14).map(s => s.name);
  console.log((up.indexOf('עידו גרוסמן') >= 0 ? '  ✓' : '  ✗') + ' "סיור עולה" takes the crew coming on: ' + up.join(','));
  up.indexOf('עידו גרוסמן') >= 0 ? pass++ : fail++;
}

/* a plain name must never be mistaken for a rule */
{
  const r = P.parseGrid({ title: 'not a rule', values: [
    ['יום', 'שעה', 'שער'],
    ['ג 4.8', '06:00-10:00', 'יורדן כהן'],
    ['', '10:00-14:00', 'דוד יורדני'],
  ] }, { now: NOW });
  const names = r.shifts.map(s => s.name);
  const good = names.indexOf('יורדן כהן') >= 0 && names.indexOf('דוד יורדני') >= 0;
  console.log((good ? '  ✓' : '  ✗') + ' names that merely contain יורד stay names: ' + names.join(','));
  good ? pass++ : fail++;
}

/* and when there is nothing to resolve it says so instead of inventing someone */
{
  const r = P.parseGrid({ title: 'dangling', values: [
    ['יום', 'שעה', 'סיור', 'כרמל ב'],
    ['ג 4.8', '02:00-06:00', '', 'סיור יורד'],
    ['', '06:00-10:00', 'אבי לוי', ''],
    ['ד 5.8', '02:00-06:00', 'בן כהן', ''],
    ['', '06:00-10:00', 'גיל מזרחי', ''],
  ] }, { now: NOW });
  const said = (r.warnings || []).some(w => w.indexOf('לפענח') >= 0);
  const clean = !r.shifts.some(s => /יורד/.test(s.name));
  console.log((said && clean ? '  ✓' : '  ✗') + ' an unresolvable rule warns and adds nobody');
  (said && clean) ? pass++ : fail++;
}

/* 20. a whole-day duty that carries into a day the sheet leaves blank.
   From the real שבצ״ק: the מטבח crew is written under Friday and covers
   Saturday too, and the only sign of it is that Saturday's column is empty.
   That is not something a parser may decide for itself, so it is an opt-in
   per-column setting — and when it fires it says so. */
{
  const RULES = { [P.normKey('מטבח')]: { mode: 'daily', start: '07:00', end: '23:59', label: 'מטבח', carry: true } };
  const values = [
    ['יום', 'שעה', 'מטבח', 'שג'],
    ['ה 6.8', '02:00-06:00', 'אבי לוי', 'בן כהן'],
    ['', '06:00-10:00', 'גיל מזרחי', 'דור פרץ'],
    ['ו 7.8', '02:00-06:00', 'הראל מירון', 'זיו דהן'],
    ['', '06:00-10:00', 'אוהד גולדווסר', 'חן גולן'],
    ['ש 8.8', '02:00-06:00', '', 'טל אזולאי'],
    ['', '06:00-10:00', '', 'יואב חדד'],
    ['א 9.8', '02:00-06:00', 'עמית פינטו', 'כפיר מלכה'],
  ];
  const on = P.parseGrid({ title: 'carry on', values }, { now: NOW, tz: TZ, rules: RULES });
  const sat = on.shifts.filter(s => s.post === 'מטבח' && ymd(s.start) === '8.8.2026').map(s => s.name);
  const said = (on.warnings || []).some(w => w.indexOf('הועתק') >= 0);
  const good = sat.length === 2 && sat.indexOf('הראל מירון') >= 0 && sat.indexOf('אוהד גולדווסר') >= 0 &&
    hour(on.shifts.find(s => s.post === 'מטבח' && ymd(s.start) === '8.8.2026').start) === 7 && said;
  console.log((good ? '  ✓' : '  ✗') + ' מטבח carries into the blank Saturday: ' + sat.join(',') + (said ? ' (warned)' : ' (SILENT)'));
  good ? pass++ : fail++;

  const off = P.parseGrid({ title: 'carry off', values }, { now: NOW, tz: TZ,
    rules: { [P.normKey('מטבח')]: { mode: 'daily', start: '07:00', end: '23:59', label: 'מטבח' } } });
  const satOff = off.shifts.filter(s => s.post === 'מטבח' && ymd(s.start) === '8.8.2026');
  console.log((satOff.length === 0 ? '  ✓' : '  ✗') + ' and stays empty when the setting is off');
  satOff.length === 0 ? pass++ : fail++;

  // Sunday is written, so it must never be overwritten by the carry
  const sun = on.shifts.filter(s => s.post === 'מטבח' && ymd(s.start) === '9.8.2026').map(s => s.name);
  console.log((sun.length === 1 && sun[0] === 'עמית פינטו' ? '  ✓' : '  ✗') +
    ' a day that IS written is left alone: ' + sun.join(','));
  (sun.length === 1 && sun[0] === 'עמית פינטו') ? pass++ : fail++;

  // and it never chains: two blank days in a row only fills the first
  const two = P.parseGrid({ title: 'no chaining', values: [
    ['יום', 'שעה', 'מטבח', 'שג'],
    ['ה 6.8', '02:00-06:00', 'אבי לוי', 'בן כהן'],
    ['ו 7.8', '02:00-06:00', '', 'זיו דהן'],
    ['ש 8.8', '02:00-06:00', '', 'טל אזולאי'],
  ] }, { now: NOW, tz: TZ, rules: RULES });
  const chained = two.shifts.filter(s => s.post === 'מטבח').map(s => ymd(s.start));
  const ok2 = chained.indexOf('7.8.2026') >= 0 && chained.indexOf('8.8.2026') < 0;
  console.log((ok2 ? '  ✓' : '  ✗') + ' it never chains past one day: ' + chained.join(','));
  ok2 ? pass++ : fail++;
}

/* ---- hidden columns ----
   Somebody retires a post by hiding its column. Reading it anyway puts people
   on watches that no longer exist. */
{
  const values = [
    ['יום', 'שעה', 'שג', 'עמדה ישנה', 'מכולות'],
    ['ה 6.8', '06:00-10:00', 'אבי לוי', 'רועי מור', 'בן כהן'],
    ['ה 6.8', '10:00-14:00', 'זיו דהן', 'רועי מור', 'טל אזולאי'],
  ];
  const skipped = P.parseGrid({ title: 'hidden', values, hcols: [3] }, { now: NOW, tz: TZ });
  const posts = skipped.posts;
  const ok = posts.indexOf('עמדה ישנה') < 0 && posts.indexOf('שג') >= 0 && posts.indexOf('מכולות') >= 0;
  console.log((ok ? '  ✓' : '  ✗') + ' a hidden column is skipped, its neighbours are not: ' + posts.join(', '));
  ok ? pass++ : fail++;

  const kept = P.parseGrid({ title: 'hidden kept', values, hcols: [3] }, { now: NOW, tz: TZ, hidden: 'keep' });
  const ok2 = kept.posts.indexOf('עמדה ישנה') >= 0;
  console.log((ok2 ? '  ✓' : '  ✗') + ' and comes back when the admin asks for it: ' + kept.posts.join(', '));
  ok2 ? pass++ : fail++;

  const ok3 = (skipped.diag.hidden || {}).cols === 1 && (kept.diag.hidden || {}).kept === true;
  console.log((ok3 ? '  ✓' : '  ✗') + ' the count is reported either way');
  ok3 ? pass++ : fail++;

  // a hidden row is a slot somebody struck out
  const hr = P.parseGrid({ title: 'hidden row', values: values.concat([
    ['ה 6.8', '14:00-18:00', 'עמית פינטו', 'רועי מור', 'ניר שגב'],
  ]), hrows: [2] }, { now: NOW, tz: TZ });
  const hours = [...new Set(hr.shifts.map(s => hour(s.start)))].sort((a, b) => a - b);
  const ok4 = hr.shifts.length > 0 && hours.indexOf(10) < 0 && hours.indexOf(6) >= 0 && hours.indexOf(14) >= 0;
  console.log((ok4 ? '  ✓' : '  ✗') + ' a hidden row drops out too, the rest stay: ' + hours.join(','));
  ok4 ? pass++ : fail++;

  // the day column is merged across both rows; hiding one must not lose the date
  const merged = P.parseGrid({ title: 'hidden + merge', values,
    merges: [{ r: 1, c: 0, rs: 2, cs: 1 }], hcols: [3] }, { now: NOW, tz: TZ });
  const days = [...new Set(merged.shifts.map(s => ymd(s.start)))];
  const ok5 = days.length === 1 && days[0] === '6.8.2026';
  console.log((ok5 ? '  ✓' : '  ✗') + ' merged cells still line up after the drop: ' + days.join(','));
  ok5 ? pass++ : fail++;

  // and when the merge's own top-left is the hidden cell, its text survives
  const anchor = P.parseGrid({ title: 'hidden anchor', values: [
    ['סתם', 'יום', 'שעה', 'שג'],
    ['', 'ה 6.8', '06:00-10:00', 'אבי לוי'],
    ['', '', '10:00-14:00', 'זיו דהן'],
  ], merges: [{ r: 1, c: 1, rs: 2, cs: 1 }], hcols: [0] }, { now: NOW, tz: TZ });
  const ad = [...new Set(anchor.shifts.map(s => ymd(s.start)))];
  const ok6 = anchor.shifts.length === 2 && ad.length === 1 && ad[0] === '6.8.2026';
  console.log((ok6 ? '  ✓' : '  ✗') + ' a merge whose corner was hidden keeps its value: ' + ad.join(','));
  ok6 ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
