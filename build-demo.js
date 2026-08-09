/* Builds demo.html — the real app, real sheet data, no Cloudflare, no Google.
   Opens straight from disk. Dates rebase to today so it's always live. */
const fs = require('fs'), p = require('path');
require('./shared/match.js');
const P = require('./shared/parse.js');


const UP = '/root/.claude/uploads/c15cd98b-5aa4-5033-9718-6043eaa36723';
const FILES = [
  ['שבצ״ק מבוא דותן', '50e1319b'],
  ['פילבוקס  חרמש', '80c939ec'],
  ['תגבצים', '9ae688c2'],
  ['כ״א', 'd4efa89c'],
];
const tabs = FILES.map(([title, pre]) => {
  const f = fs.readdirSync(UP).find(x => x.startsWith(pre) && x.endsWith('.csv'));
  return { title, values: P.parseCSV(fs.readFileSync(p.join(UP, f), 'utf8')) };
});

const TZ = 'Asia/Jerusalem';
const RULES = { [P.normKey('מטבח')]: { mode: 'daily', start: '07:00', end: '23:59', label: 'מטבח' } };
const W = P.parseWorkbook(tabs, { tz: TZ, rules: RULES });

const roster = {
  id: 'DEMO', title: 'שבצ״ק מבוא דותן מבצעית', tz: TZ, v: '3:1',
  names: W.names, aliases: W.aliases, locations: W.locations,
  warnings: W.warnings, posts: W.posts, rules: RULES, diags: W.diags,
  tabs: W.tabs, scheduleTabs: W.scheduleTabs,
  shifts: W.shifts.map(s => ({ n: s.person || s.name, p: s.post, t: s.tab, s: +s.start, e: +s.end, k: s.key, x: s.aux ? 1 : 0 })),
};

const shim = `
/* ---------------- demo shim: serves /api/* from baked-in data ---------------- */
(function () {
  var ROSTER = ${JSON.stringify(roster)};

  // Slide the roster onto today. Anchor on the BUSIEST day, not the earliest —
  // some tabs carry stale dates from months ago and would drag everything with
  // them.
  var day = 864e5;
  var midnight = function (t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  var byDay = {};
  ROSTER.shifts.forEach(function (s) { var k = midnight(s.s); byDay[k] = (byDay[k] || 0) + 1; });
  var anchor = Object.keys(byDay).sort(function (a, b) { return byDay[b] - byDay[a]; })[0];
  var shift = midnight(Date.now()) - +anchor;
  ROSTER.shifts.forEach(function (s) { s.s += shift; s.e += shift; });
  ROSTER.updatedAt = Date.now() - 90000;

  var now = Date.now();
  var live = ROSTER.shifts.filter(function (s) { return s.s <= now && now < s.e && !s.x; });
  var ME = live.length ? live[Math.floor(live.length / 2)].n : ROSTER.names[0];

  var N = window.SHNative;
  var natives = {}, nSeq = 0, active = 'DEMO';
  if (window.__demoNative) { natives[window.__demoNative.id] = window.__demoNative; active = window.__demoNative.id; }
  var state = {
    me: null, openUntil: 0, lastSeen: 0, contacts: [], bcast: null, bcSeq: 0, link: null, nme: {},
    members: [
      { account: 'ABC-DEF-GHJ', email: 'you@gmail.com', name: 'אתה', via: 'sheets', role: 'admin', joinedAt: now - 6 * day, person: ME },
      { account: 'K2M-4PQ-7RS', email: 'liav@gmail.com', name: 'ליאב', via: 'invite', role: 'member', joinedAt: now - 3 * day, person: 'ליאב עובד' },
      { account: 'W8X-3YZ-6AB', email: 'shahar@gmail.com', name: 'שחר', via: 'open', role: 'member', joinedAt: now - day, person: 'שחר גינת' }
    ],
    requests: [{ account: 'Q9R-2TT-5VV', email: 'ido@gmail.com', name: 'עידו', at: now - 3600e3 }]
  };

  var changed = ROSTER.shifts.filter(function (s) { return s.n === ME && s.s > now; })[0];

  function reply(o) {
    return Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') < 0) return realFetch(input, init);
    var path = url.split('?')[0].replace(/^.*\\/api\\//, '/api/');
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { }

    switch (path) {
      case '/api/config': return reply({ version: '3.0.0 (demo)', clientId: '', vapidPublic: '', defaultSheet: '' });
      case '/api/sheets': return reply({
        sheets: [{
          id: 'DEMO', kind: 'sheets', title: ROSTER.title, person: state.me,
          lastPoll: ROSTER.updatedAt, lastChange: ROSTER.updatedAt, shiftCount: ROSTER.shifts.length,
          nameCount: ROSTER.names.length, pending: state.requests.length, openUntil: state.openUntil
        }].concat(Object.keys(natives).map(function (k) {
          return { id: k, kind: 'native', title: natives[k].title, person: state.nme[k] || null,
                   lastPoll: Date.now(), shiftCount: N.compile(natives[k], { tz: ROSTER.tz }).shifts.length,
                   nameCount: natives[k].people.length };
        })), active: active
      });
      case '/api/roster': {
        var rq = url.split('sheet=')[1] || '';
        var rid2 = decodeURIComponent((rq.split('&')[0]) || '');
        if (natives[rid2]) {
          var comp = N.compile(natives[rid2], { tz: ROSTER.tz });
          return reply(Object.assign(comp, { me: state.nme[rid2] || null, nicknames: [], account: 'ABC-DEF-GHJ',
            lastSeen: 0, lastPoll: Date.now(), lastChange: Date.now(), lastTick: Date.now(),
            contacts: state.contacts, bcast: state.bcast }));
        }
        return reply(Object.assign({}, ROSTER, {
          me: state.me, nicknames: [], account: 'ABC-DEF-GHJ', lastSeen: state.lastSeen,
          lastPoll: Date.now() - 90000, lastChange: ROSTER.updatedAt, lastTick: Date.now() - 90000,
          contacts: state.contacts, bcast: state.bcast
        }));
      }
      case '/api/changes': return reply({
        at: now - 120000, total: 3,
        mine: (state.me === ME && changed) ? { name: ME, added: [{ s: changed.s, e: changed.e, p: changed.p, t: changed.t }], removed: [] } : null
      });
      case '/api/me':
        if (body.person !== undefined) {
          if (natives[body.sheet]) state.nme[body.sheet] = body.person;
          else { state.me = body.person; state.members[0].person = body.person; }
        }
        if (body.seen) state.lastSeen = Date.now();
        return reply({ ok: true, person: state.me });
      case '/api/sheets/members': return reply({ members: state.members, admin: true, owner: 'ABC-DEF-GHJ', me: 'ABC-DEF-GHJ', openUntil: state.openUntil });
      case '/api/sheets/requests': return reply({ requests: state.requests });
      case '/api/sheets/approve':
        state.requests = state.requests.filter(function (r) {
          if (r.account !== body.account) return true;
          state.members.push({ account: r.account, email: r.email, name: r.name, via: 'request', role: 'member', joinedAt: Date.now(), person: null });
          return false;
        });
        return reply({ ok: true });
      case '/api/sheets/deny':
        state.requests = state.requests.filter(function (r) { return r.account !== body.account; });
        return reply({ ok: true });
      case '/api/sheets/role':
        state.members.forEach(function (m) { if (m.account === body.account) m.role = body.role; });
        return reply({ ok: true });
      case '/api/sheets/owner': return reply({ ok: true });
      case '/api/sheets/revoke':
        state.members = state.members.filter(function (m) { return m.account !== body.account; });
        return reply({ ok: true });
      case '/api/sheets/open':
        state.openUntil = body.minutes ? Date.now() + body.minutes * 60000 : 0;
        var n = 0;
        if (body.minutes) { n = state.requests.length; state.requests.forEach(function (r) { state.members.push({ account: r.account, email: r.email, name: r.name, via: 'open', role: 'member', joinedAt: Date.now(), person: null }); }); state.requests = []; }
        return reply({ ok: true, openUntil: state.openUntil, approved: n });
      case '/api/sheets/invite':
        var codes = [];
        for (var i = 0; i < (body.count || 1); i++) codes.push('DEMO' + String(i + 1).padStart(4, '0'));
        return reply({ codes: codes, sheet: 'DEMO', title: ROSTER.title });
      case '/api/sheets/rules':
        if (init && init.method === 'POST') {
          if (body.rules !== undefined) ROSTER.rules = body.rules || {};
          if (body.hidden !== undefined) state.hidden = body.hidden;
          return reply({ ok: true, rules: ROSTER.rules, hidden: state.hidden || 'skip', hiddenCount: 2 });
        }
        return reply({ rules: ROSTER.rules, posts: ROSTER.posts, admin: true,
                       hidden: state.hidden || 'skip', hiddenCount: 2 });
      case '/api/account/transfer': return reply({ code: 'DEMOXFER01', expiresIn: 900 });
      case '/api/refresh': return reply({ unchanged: true });
      case '/api/badge': {
        var nowB = Date.now();
        var mineB = state.me ? ROSTER.shifts.filter(function (x) {
          return !x.x && x.n === state.me && x.e > nowB && x.s < nowB + 864e5; }) : [];
        var nxB = mineB.filter(function (x) { return x.s > nowB; }).sort(function (a, b) { return a.s - b.s; })[0];
        return reply({ n: mineB.length, next: nxB ? nxB.s : 0, on: mineB.some(function (x) { return x.s <= nowB; }) ? 1 : 0 });
      }
      case '/api/sheets/contacts':
        if (init && init.method === 'POST') { state.contacts = N.sanitiseContacts(body.contacts || []); return reply({ ok: true, contacts: state.contacts }); }
        return reply({ contacts: state.contacts, admin: true });
      case '/api/sheets/broadcast':
        if (body.clear) { state.bcast = null; return reply({ ok: true, cleared: true }); }
        state.bcast = { text: String(body.text || '').slice(0, 200), at: Date.now(), from: 'אתה', id: 'bc' + (++state.bcSeq) };
        return reply({ ok: true, sent: state.members.length - 1, members: state.members.length - 1, bcast: state.bcast });
      case '/api/sheets/link':
        if (init && init.method === 'POST') {
          state.link = body.minutes ? { code: 'DEMOLINK99', until: Date.now() + body.minutes * 60000, max: +body.max || 0, used: 0 } : null;
          return reply({ link: state.link });
        }
        return reply({ link: state.link });
      case '/api/sheets/leave':
        if (!body.confirm && natives[body.id]) return reply({ needConfirm: true, error: 'אתה האחרון בשבצ״ק הזה. אם תצא הוא יימחק לגמרי — הוא קיים רק כאן.' });
        delete natives[body.id];
        if (active === body.id) active = 'DEMO';
        return reply({ ok: true, deleted: true });

      /* the in-app שבצ"ק, built and compiled entirely in the page */
      case '/api/native/create': {
        var nid = 'n_demo' + (++nSeq);
        natives[nid] = N.sanitise(Object.assign({}, body.doc || {}, { id: nid }));
        active = nid;
        return reply({ ok: true, id: nid, title: natives[nid].title });
      }
      case '/api/native': {
        var q = url.split('sheet=')[1] || '';
        var id = decodeURIComponent((q.split('&')[0]) || body.sheet || '');
        var cur = natives[id];
        if (!cur) return reply({ error: 'not native' });
        if (!(init && init.method === 'POST')) return reply({ doc: cur, admin: true });
        if (body.rev != null && +body.rev !== (cur.rev || 0)) return reply({ error: 'מישהו אחר ערך את השבצ״ק בינתיים.', stale: true, doc: cur });
        var doc = N.sanitise(Object.assign({}, body.doc, { id: id }));
        doc.rev = (cur.rev || 0) + 1;
        natives[id] = doc;
        return reply({ ok: true, rev: doc.rev, shifts: N.compile(doc, { tz: ROSTER.tz }).shifts.length, changed: 0 });
      }
      default: return reply({ ok: true });
    }
  };

  try {
    localStorage.setItem('sh.sid', JSON.stringify('DEMO'));
    localStorage.setItem('sh.sheet', JSON.stringify('DEMO'));
  } catch (e) { }

  window.__demoSuggest = ME;
  window.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.className = 'demobar';
    b.innerHTML = 'הדגמה · נתוני אמת מהשבצ״ק, בלי שרת ובלי Google · נסה <b>' + ME + '</b>' +
      '<button id="demoreset">אפס</button>';
    document.body.appendChild(b);
    document.getElementById('demoreset').onclick = function () { try { localStorage.clear(); } catch (e) { } location.reload(); };
  });
})();
`;

/* ---- the builder demo: same app, but it opens on a שבצ״ק built in-app,
   already using the awkward post types, so you can push it around straight
   away instead of typing eighteen names first. ---- */
const BUILDER = `
(function () {
  var N = window.SHNative, G = window.SHGen;
  var PEOPLE = ${JSON.stringify((function(){const a=W.names.filter(n=>n.split(' ').length>=2);const out=[];const step=Math.max(1,Math.floor(a.length/18));for(let i=0;out.length<18&&i<a.length;i+=step)out.push(a[i]);return out;})())};
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var doc = N.sanitise({
    id: 'n_demo1', title: 'מוצב לדוגמה', tz: '${TZ}',
    people: PEOPLE,
    posts: [
      { name: 'שג', per: 1, mode: 'slot' },
      { name: 'סיור', per: 2, mode: 'slot' },
      { name: 'מכולות', per: 1, mode: 'slot' },
      { name: 'כרמל א', per: 4, mode: 'daily', start: '00:00', end: '23:59', exempt: true },
      { name: 'כרמל ב', mode: 'daily', start: '00:00', end: '23:59', from: { posts: ['סיור', 'שג'], at: '06:00' } },
      { name: 'מטבח', per: 2, mode: 'daily', start: '07:00', end: '23:59', carry: true }
    ],
    days: N.daysFrom(ymd(start), 5),
    slots: G.slotsEvery('02:00', 4)
  });
  var out = N.autofill(doc);
  window.__demoNative = out.doc;
  window.__demoEditor = 'n_demo1';
  window.__demoRest = out.minRest;
  window.__prefill = {
    title: 'שבצ״ק פלוגה ב׳',
    people: PEOPLE.join('\\n'),
    posts: 'שג\\nסיור x2\\nמכולות\\nכרמל א x4 @00:00-23:59\\nכרמל ב @00:00-23:59\\nמטבח x2 @07:00-23:59',
    days: 5
  };
})();
`;

const tpl = fs.readFileSync(p.join(__dirname, 'app/index.tpl.html'), 'utf8');
const match = fs.readFileSync(p.join(__dirname, 'shared/match.js'), 'utf8');
const app = fs.readFileSync(p.join(__dirname, 'app/app.js'), 'utf8');
const gen = fs.readFileSync(p.join(__dirname, 'shared/gen.js'), 'utf8');
const native = fs.readFileSync(p.join(__dirname, 'shared/native.js'), 'utf8');

function render(extra, title) {
  return tpl
  .replace('<link rel="manifest" href="/manifest.webmanifest">', '')
  .replace('<link rel="apple-touch-icon" href="/icon-180.png">', '')
  .replace('<link rel="icon" href="/icon.svg" type="image/svg+xml">', '')
  .replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', '')
  .replace('<title>שבצ״ק</title>', '<title>שבצ״ק — הדגמה</title>')
  .replace('</style>', `
.demobar{position:fixed;inset-inline:0;bottom:0;background:var(--card2);border-top:1px solid var(--line);
 padding:9px 14px calc(9px + env(safe-area-inset-bottom));font-size:12.5px;color:var(--dim);text-align:center;z-index:20}
.demobar b{color:var(--acc)}
.demobar button{margin-inline-start:10px;border:1px solid var(--line);border-radius:8px;padding:3px 10px;font-size:12px;background:var(--card)}
body{padding-bottom:70px}
</style>`)
  .replace('/*MATCH*/', () => match)
  .replace('/*GEN*/', () => gen)
  .replace('/*NATIVE*/', () => native)
  .replace('/*APP*/', () => (extra || '') + '\n' + shim + '\n' + app)
  .replace('הדגמה · נתוני אמת מהשבצ״ק, בלי שרת ובלי Google', title || 'הדגמה · נתוני אמת מהשבצ״ק, בלי שרת ובלי Google');
}

const html = render('', '');
fs.writeFileSync(p.join(__dirname, 'demo.html'), html);
const bhtml = render(BUILDER, 'הדגמת בניית שבצ״ק · הכל נשמר בדפדפן בלבד');
fs.writeFileSync(p.join(__dirname, 'demo-builder.html'), bhtml);
console.log('demo.html', (html.length / 1024).toFixed(0) + ' KB ·',
  roster.shifts.length, 'shifts ·', roster.names.length, 'people');
console.log('demo-builder.html', (bhtml.length / 1024).toFixed(0) + ' KB');
