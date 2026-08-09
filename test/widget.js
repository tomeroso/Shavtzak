/* What the iOS widget will say. Every string here ends up on somebody's home
   screen, in a build we cannot change without a week of App Review. */
require('../shared/match.js');
require('../shared/parse.js');
require('../shared/native.js');
const TZ = 'Asia/Jerusalem';
const env = { TZ_NAME: TZ };
let pass = 0, fail = 0;
const ok = (t, cond, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + t + (extra ? ': ' + extra : ''));
  cond ? pass++ : fail++;
};

(async () => {
  const { widgetView } = await import('../worker/index.js');
  const now = Date.now();
  const H = 3600e3;
  const roster = tz => ({ tz: tz || TZ, names: ['תומר אוסוביצקי'], aliases: {}, shifts: [] });

  const mk = (list, evs, pevs) => widgetView(env, Object.assign(roster(), {
    names: ['תומר אוסוביצקי'],
    shifts: list.map(x => ({ n: 'תומר אוסוביצקי', p: x.p, s: x.s, e: x.e, x: 0 })),
  }), 'תומר אוסוביצקי', evs || [], pevs || []);

  // ---- on watch right now
  let v = mk([{ p: 'שער ראשי', s: now - H, e: now + H }, { p: 'מכולות', s: now + 6 * H, e: now + 10 * H }]);
  ok('on watch reads as on watch', v.state === 'on', v.state);
  ok('it counts down to the end, not the start', v.end === now + H && v.start === now - H);
  ok('the post is named', v.line2 === 'שער ראשי', v.line2);
  ok('and it says what comes after', /אחר כך/.test(v.line3), v.line3);

  // ---- the next one
  v = mk([{ p: 'מכולות', s: now + 5 * H, e: now + 9 * H }]);
  ok('a watch hours away is not urgent', v.state === 'free', v.state);
  ok('the hour is stated in words', /ב-\d\d:\d\d/.test(v.line1), v.line1);
  ok('with the end time under it', /^עד \d\d:\d\d$/.test(v.line3), v.line3);

  v = mk([{ p: 'מכולות', s: now + 20 * 60000, e: now + 4 * H }]);
  ok('twenty minutes away turns orange', v.state === 'soon', v.state);

  // ---- nothing left
  v = mk([{ p: 'שער', s: now - 9 * H, e: now - 5 * H }]);
  ok('nothing ahead is זמן רפיסה', v.line1 === 'זמן רפיסה', v.line1);
  ok('and it says why', v.line3 === 'אין עוד שמירות', v.line3);

  // ---- an event can be the next thing
  v = mk([{ p: 'שער', s: now + 8 * H, e: now + 12 * H }],
         [{ id: 'e1', at: now + 2 * H, mins: 0, text: 'מסדר מפקד', to: { kind: 'all' } }]);
  ok('a לוז item ahead of the watch wins', v.line2 === 'מסדר מפקד', v.line2);
  ok('and is marked as an event', v.kind === 'event', v.kind);
  ok('the watch is still listed after it', v.soon.some(x => x.label === 'שער'), JSON.stringify(v.soon));
  ok('and the headline is not repeated in the list',
     !v.soon.some(x => x.label === v.line2), JSON.stringify(v.soon.map(x => x.label)));

  // an event you cannot attend is not your next thing
  v = mk([{ p: 'שער', s: now + H, e: now + 5 * H }],
         [{ id: 'e2', at: now + 2 * H, mins: 0, text: 'מסדר מפקד', to: { kind: 'all' } }]);
  ok('an event inside your watch is dropped', v.line2 === 'שער' && !v.soon.some(x => x.kind === 'event'),
     v.line2 + ' / ' + JSON.stringify(v.soon));

  // an event for somebody else's squad never reaches this person
  v = mk([], [{ id: 'e3', at: now + H, text: 'רק פיקוד', to: { kind: 'people', names: ['מישהו אחר'] } }]);
  ok('someone else\u2019s לוז is not shown', v.line1 === 'זמן רפיסה', v.line1 + ' / ' + v.line2);

  // a personal note is
  v = mk([], [], [{ id: 'p1', at: now + H, text: 'לקחת נשק' }]);
  ok('a personal note is', v.line2 === 'לקחת נשק', v.line2);

  // ---- no name chosen yet
  v = widgetView(env, roster(), null, [], []);
  ok('no name gives a useful answer', v.line1 === 'לא נבחר שם' && /פתח/.test(v.line3), v.line1 + ' / ' + v.line3);

  // ---- the payload must stay small and boring
  v = mk([{ p: 'שער', s: now + H, e: now + 5 * H }]);
  const keys = Object.keys(v).sort().join(',');
  ok('nothing but text and two timestamps', keys === 'at,end,kind,line1,line2,line3,soon,start,state,tz', keys);
  ok('at most three rows follow', v.soon.length <= 3, String(v.soon.length));

  // ---- days are named from the roster's timezone, not the server's
  const tomorrow = now + 26 * H;
  v = mk([{ p: 'שער', s: tomorrow, e: tomorrow + 4 * H }]);
  ok('a day away says מחר or names the day', /מחר|יום /.test(v.line1), v.line1);

  /* The Android widget reads exactly these fields out of the JSON, by name.
     A rename here is a widget that goes blank on every phone in the unit until
     the next release goes through the Play Store, so pin them. */
  v = mk([{ p: 'שער', s: now + H, e: now + 5 * H }]);
  const contract = ['at', 'end', 'kind', 'line1', 'line2', 'line3', 'soon', 'start', 'state', 'tz'];
  ok('the field names the phones read are unchanged',
     contract.every(k => k in v), Object.keys(v).join(','));
  ok('state is one of four words', ['on', 'soon', 'free', 'none'].includes(v.state), v.state);
  ok('start and end are milliseconds, not seconds', v.start > 1e12, String(v.start));
  ok('every row that follows has a time and a label',
     v.soon.every(x => typeof x.t === 'number' && typeof x.when === 'string' && typeof x.label === 'string'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
