/* Local stand-in for the Worker: serves public/ and the /api surface,
   built from the real exported tabs so the UI can be driven end to end. */
const http = require('http'), fs = require('fs'), p = require('path');
require('../shared/match.js');
const P = require('../shared/parse.js');
require('../shared/gen.js');
const NAT = require('../shared/native.js');

const FIX = require('./fixtures.js');
const tabs = FIX.tabs(P);
if (!tabs) { FIX.skip('the mock server'); process.exit(0); }
const RULES = { [P.normKey('מטבח')]: { mode: 'daily', start: '07:00', end: '23:59', label: 'מטבח' } };
const R = P.parseWorkbook(tabs, { tz: 'Asia/Jerusalem', rules: RULES });
/* The exported tabs are from a fixed week, so by default nothing is ever "on
   watch now". REBASE=1 slides every shift by whole days onto today, which is
   what the board tests need. */
if (process.env.REBASE) {
  const day = 864e5;
  const counts = {};
  R.shifts.forEach(s => { const k = Math.floor(+s.start / day); counts[k] = (counts[k] || 0) + 1; });
  const busiest = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const delta = (Math.floor(Date.now() / day) - busiest) * day;
  R.shifts.forEach(s => { s.start = new Date(+s.start + delta); s.end = new Date(+s.end + delta); });
}
const roster = {
  title: 'שבצ״ק מבוא דותן מבצעית', updatedAt: Date.now(), tz: 'Asia/Jerusalem',
  tabs: R.tabs, names: R.names, aliases: R.aliases, locations: R.locations, warnings: R.warnings, posts: R.posts, diags: R.diags,
  shifts: R.shifts.map(s => ({ n: s.person || s.name, p: s.post, t: s.tab, s: +s.start, e: +s.end, k: s.key, x: s.aux ? 1 : 0, d: s.src, r: s.row })),
};
let me = null;
let openUntil = 0;
let glink = null;
const natives = {};
const nativeMe = {};
let nativeSeq = 1;
const left = {};
let bcast = null;
let groups = [];
const events = { all: [], me: [] };
let evSeq = 1;
let bcSeq = 1;
const contacts = { '1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx': [{ name: 'אלון מזרחי', role: 'מ״פ', phone: '050-1234567' }] };
let active = '1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx';
let remind = 0;
let widgetToken = null;
const devices = {};
const SHEET = '1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx';
let members = [
  { account: 'ABC-DEF-GHJ', email: 'you@gmail.com', name: 'אלון', via: 'sheets', role: 'admin', joinedAt: 1, person: null },
  { account: 'K2M-4PQ-7RS', email: 'friend@gmail.com', name: 'חבר', via: 'invite', role: 'member', joinedAt: 2, person: 'ליאב עובד' },
];
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (o, s) => { res.writeHead(s || 200, { 'content-type': 'application/json;charset=utf-8' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/session') { res.writeHead(401,{'content-type':'application/json'}); return res.end('{"error":"unauthorised"}'); }
  if (u.pathname === '/api/config') return send({ version: '3.1.0', clientId: 'test.apps.googleusercontent.com', vapidPublic: 'BFAKE', defaultSheet: '', pickerApiKey: 'FAKEKEY', appId: '626094394386' });
  if (u.pathname === '/api/sheets' && process.env.NO_SHEETS && !Object.keys(natives).length)
    return send({ sheets: [], active: null });
  if (u.pathname === '/api/sheets') return send({
    sheets: (process.env.NO_SHEETS ? [] : [
      { id: SHEET, kind: 'sheets', title: roster.title, person: me, lastPoll: Date.now(), shiftCount: roster.shifts.length, nameCount: roster.names.length, pending: 1 },
      { id: 'OTHERSHEETxxxxxxxxxxxxxxxxxxxxxx', kind: 'sheets', title: 'פילבוקס 190', person: null, lastPoll: Date.now(), shiftCount: 12, nameCount: 6 },
    ].filter(x => !left[x.id])).concat(Object.values(natives).map(d => ({
      id: d.id, kind: 'native', title: d.title, person: nativeMe[d.id] || null, lastPoll: Date.now(),
      shiftCount: NAT.compile(d).shifts.length, nameCount: d.people.length,
    }))), active: active,
  });

  if (u.pathname === '/api/native/create') {
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const id = 'n_mock' + (nativeSeq++);
      const doc = NAT.sanitise(Object.assign({}, JSON.parse(b || '{}').doc || {}, { id }));
      natives[id] = doc; active = id;
      send({ ok: true, id, title: doc.title });
    });
  }
  if (u.pathname === '/api/native') {
    const id = u.searchParams.get('sheet');
    const cur = natives[id];
    if (!cur) return send({ error: 'not native' }, 404);
    if (req.method !== 'POST') return send({ doc: cur, admin: true });
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      if (j.rev != null && +j.rev !== (cur.rev || 0)) return send({ error: 'stale', stale: true, doc: cur }, 409);
      const doc = NAT.sanitise(Object.assign({}, j.doc, { id }));
      doc.rev = (cur.rev || 0) + 1;
      natives[id] = doc;
      send({ ok: true, rev: doc.rev, shifts: NAT.compile(doc).shifts.length, changed: 3 });
    });
  }
  if (u.pathname === '/api/sheets/events') {
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      const key = j.personal ? 'me' : 'all';
      if (j.clearAll) { events[key] = []; return send({ ok: true, events: [] }); }
      if (j.remove) { events[key] = (events[key] || []).filter(x => x.id !== j.remove); return send({ ok: true, events: events[key] }); }
      const to = (j.personal) ? { kind: 'self' }
        : (j.to && j.to.kind === 'people') ? { kind: 'people', names: j.to.names || [], group: j.to.group || '' } : { kind: 'all' };
      const made = (j.items || []).map((it, i) => ({ id: 'ev' + (evSeq++), at: +it.at, mins: +it.mins || 0,
        text: String(it.text || ''), title: j.title || '', to, from: 'אלון' }));
      events[key] = (events[key] || []).concat(made).sort((a, b) => a.at - b.at);
      send({ ok: true, added: made.length, sent: made.length ? 7 : 0, events: events[key] });
    });
  }
  if (u.pathname === '/api/sheets/groups') {
    if (req.method !== 'POST') return send({ groups, admin: true });
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      groups = NAT.sanitiseGroups(JSON.parse(b || '{}').groups || [], roster.names);
      send({ ok: true, groups });
    });
  }
  if (u.pathname === '/api/sheets/broadcast') {
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      if (j.clear) {
        if (bcast) events.all = events.all.filter(x => x.id !== bcast.id);
        bcast = null; return send({ ok: true, cleared: true });
      }
      bcast = { text: String(j.text || '').slice(0, 200), at: Date.now(), from: 'אלון', id: 'bc' + (bcSeq++),
                to: (j.to && j.to.kind === 'people') ? { kind: 'people', names: j.to.names || [], group: j.to.group || '' } : { kind: 'all' } };
      /* Same rule as the worker: an hour on a message makes it an appointment,
         so it lands in everybody's day as well. */
      if (j.at) {
        bcast.when = +j.at; bcast.mins = +j.mins || 0;
        events.all.push({ id: bcast.id, at: +j.at, mins: bcast.mins, text: bcast.text,
                          title: '', to: bcast.to, from: 'אלון' });
        events.all.sort((a, b) => a.at - b.at);
      }
      send({ ok: true, sent: 7, members: 8, bcast });
    });
  }
  if (u.pathname === '/api/sheets/contacts') {
    const id = u.searchParams.get('sheet') || SHEET;
    if (req.method !== 'POST') return send({ contacts: contacts[id] || [], admin: !process.env.NOT_ADMIN });
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      contacts[id] = NAT.sanitiseContacts(JSON.parse(b || '{}').contacts || []);
      send({ ok: true, contacts: contacts[id] });
    });
  }
  if (u.pathname === '/api/sheets/members') { if (process.env.NOT_ADMIN) { res.writeHead(403,{'content-type':'application/json'}); return res.end('{"error":"אין לך הרשאה"}'); } return send({ members, admin: true, owner: 'ABC-DEF-GHJ', me: 'ABC-DEF-GHJ', openUntil, link: glink && Date.now() < glink.until ? glink : null }); }
  if (u.pathname === '/api/sheets/link') {
    if (req.method !== 'POST') return send({ link: glink && Date.now() < glink.until ? glink : null });
    let b=''; req.on('data',d=>b+=d);
    return req.on('end',()=>{ const j=JSON.parse(b||'{}'); const mn=+j.minutes||0;
      glink = mn ? { code:'GROUPCODE9', until: Date.now()+mn*60000, max:+j.max||0, used:0, group: j.group || '' } : null;
      send({ link: glink }); });
  }
  if (u.pathname === '/api/sheets/requests') return send({ requests: [{ account: 'Q9R-2TT-5VV', email: 'newguy@gmail.com', name: 'עידו', at: Date.now() }] });
  if (u.pathname === '/api/sheets/open') { let b=''; req.on('data',d=>b+=d); return req.on('end',()=>{ const mn=JSON.parse(b||'{}').minutes||0; openUntil = mn ? Date.now()+mn*60000 : 0; send({ok:true, openUntil, approved: mn?1:0}); }); }
  if (u.pathname === '/api/sheets/role' || u.pathname === '/api/sheets/owner') { let b=''; req.on('data',d=>b+=d); return req.on('end',()=>send({ok:true})); }
  if (u.pathname === '/api/sheets/approve' || u.pathname === '/api/sheets/deny') { let b=''; req.on('data',d=>b+=d); return req.on('end',()=>send({ok:true})); }
  if (u.pathname === '/api/sheets/rules') {
    if (req.method !== 'POST') return send({ rules: { 'מטבח': { mode: 'daily', start: '07:00', end: '23:59' } }, posts: R.posts, admin: true });
    let b = ''; req.on('data', d => b += d); return req.on('end', () => send({ ok: true }));
  }
  if (u.pathname === '/api/sheets/invite') { let b = ''; req.on('data', d => b += d); return req.on('end', () => { const n = (JSON.parse(b || '{}').count) || 1; send({ codes: Array.from({ length: n }, (_, i) => 'MOCK' + String(i).padStart(4, '0')), sheet: SHEET, title: roster.title }); }); }
  if (u.pathname === '/api/sheets/revoke') { let b = ''; req.on('data', d => b += d); return req.on('end', () => { const a = JSON.parse(b || '{}').account; members = members.filter(m => m.account !== a); send({ ok: true }); }); }
  if (u.pathname === '/api/sheets/leave') {
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      if (natives[j.id]) {
        if (!j.confirm) return send({ needConfirm: true, error: 'אתה האחרון בשבצ״ק הזה. אם תצא הוא יימחק לגמרי, הוא קיים רק כאן.' }, 409);
        delete natives[j.id];
        return send({ ok: true, deleted: true });
      }
      left[j.id] = true;
      send({ ok: true, handover: j.id === SHEET ? 'חבר' : null });
    });
  }
  if (u.pathname === '/api/sheets/join') { let b = ''; req.on('data', d => b += d); return req.on('end', () => send({ ok: true, id: SHEET, title: roster.title })); }
  if (u.pathname === '/api/roster' && process.env.DROP_PERSON) {
    const re = new RegExp(process.env.DROP_PERSON);
    return send({
      ...roster, id: SHEET,
      shifts: roster.shifts.filter(x => !re.test(x.n)),
      names: roster.names.filter(n => !re.test(n)),
      me, nicknames: [], remind, account: 'ABC-DEF-GHJ', lastSeen: 0,
    });
  }
  if (u.pathname === '/api/roster') {
    const nid = u.searchParams.get('sheet');
    if (natives[nid]) {
      const c = NAT.compile(natives[nid]);
      return send(Object.assign(c, { me: nativeMe[nid] || null, nicknames: [], remind: 0, lastSeen: 0, account: 'ABC-DEF-GHJ', contacts: contacts[nid] || [] }));
    }
    if (u.searchParams.get('sheet') === 'OTHERSHEETxxxxxxxxxxxxxxxxxxxxxx')
      return send({ id: 'OTHERSHEETxxxxxxxxxxxxxxxxxxxxxx', title: 'פילבוקס 190', updatedAt: Date.now(), names: ['עידו אס'], aliases: {}, locations: {}, warnings: [], shifts: [], me: null, nicknames: [], lastSeen: 0, account: 'ABC-DEF-GHJ' });
    return send({ ...roster, id: SHEET, me, nicknames: [], remind, account: 'ABC-DEF-GHJ', lastSeen: 0,
      lastPoll: Date.now() - (+process.env.STALE_MIN || 3) * 60000, lastChange: Date.now() - 201 * 60000,
      lastTick: Date.now() - (+process.env.STALE_MIN || 3) * 60000, lastError: null,
      contacts: contacts[SHEET] || [], groups,
      events: (events.all || []).filter(x => NAT.inAudience(x.to, me)).concat((events.me || []).map(x => ({ ...x, mine: 1 }))).sort((a, b) => a.at - b.at),
      bcast: (!bcast || NAT.inAudience(bcast.to, me)) ? bcast : null });
  }
  /* The iOS widget. The real worker builds these sentences; here we hand back
     the same shape so the endpoint's contract is exercised. */
  if (u.pathname === '/api/widget/token') {
    if (req.method !== 'POST') return send({ token: widgetToken });
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      widgetToken = j.revoke ? null : 'wt_MOCKWIDGETTOKEN';
      send({ ok: true, token: widgetToken });
    });
  }
  if (u.pathname === '/api/notify/ext' || u.pathname === '/api/fcm/register' || u.pathname === '/api/apns/register') {
    const h = req.headers.authorization || '';
    if (!widgetToken || h !== 'Bearer ' + widgetToken) return send({ error: 'unauthorised' }, 401);
    if (u.pathname === '/api/notify/ext') return send({ kind: 'reminder', mins: 15, post: 'שער ראשי',
      start: Date.now() + 15 * 60000, end: Date.now() + 4 * 36e5, withMe: ['יוסי לוי'] });
    let b = ''; req.on('data', d => b += d);
    return req.on('end', () => {
      const j = JSON.parse(b || '{}');
      if (!j.token || String(j.token).length < 20) return send({ error: 'bad device token' }, 400);
      devices[u.pathname] = String(j.token);
      send({ ok: true });
    });
  }
  if (u.pathname === '/api/widget') {
    const h = req.headers.authorization || '';
    if (!widgetToken || h !== 'Bearer ' + widgetToken) return send({ error: 'unauthorised' }, 401);
    const now = Date.now();
    const nk = NAT.normKey || (x => x);
    const mineW = me ? roster.shifts.filter(x => !x.x && nk(x.n) === nk(me)).sort((a, b) => a.s - b.s) : [];
    const cur = mineW.find(x => x.s <= now && now < x.e);
    const ahead = mineW.filter(x => x.s > now);
    const hm = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
    const out = { at: now, tz: 'Asia/Jerusalem', state: 'free', line1: '', line2: '', line3: '',
                  start: 0, end: 0, kind: '', soon: ahead.slice(0, 3).map(x => ({ t: x.s, when: hm(x.s), label: x.p || '', kind: 'watch' })) };
    if (cur) Object.assign(out, { state: 'on', kind: 'watch', start: cur.s, end: cur.e, line1: 'עד ' + hm(cur.e), line2: cur.p || '' });
    else if (ahead.length) Object.assign(out, { state: (ahead[0].s - now <= 45 * 60000) ? 'soon' : 'free', kind: 'watch',
      start: ahead[0].s, end: ahead[0].e, line1: 'היום ב-' + hm(ahead[0].s), line2: ahead[0].p || '' });
    else Object.assign(out, { line1: 'זמן רפיסה', line3: 'אין עוד שמירות' });
    return send(out);
  }
  if (u.pathname === '/api/badge') {
    const now = Date.now();
    const nk = NAT.normKey || (x => x);
    const mineNow = me ? roster.shifts.filter(x => !x.x && nk(x.n) === nk(me) && x.e > now && x.s < now + 864e5) : [];
    const nx = mineNow.filter(x => x.s > now).sort((a, b) => a.s - b.s)[0];
    return send({ n: mineNow.length, next: nx ? nx.s : 0, on: mineNow.some(x => x.s <= now) ? 1 : 0 });
  }
  if (u.pathname === '/api/changes') return send({
    at: Date.now(), total: 2,
    mine: me === 'תומר אוסוביצקי' ? { name: me, added: [{ s: Date.now() + 3 * 36e5, e: Date.now() + 7 * 36e5, p: 'שער ראשי', t: 'שבצ״ק מבוא דותן' }], removed: [] } : null,
  });
  if (u.pathname === '/api/me') { let b = ''; req.on('data', d => b += d); return req.on('end', () => { const j = JSON.parse(b || '{}'); if (j.person !== undefined) { if (natives[j.sheet]) nativeMe[j.sheet] = j.person; else me = j.person; } if (j.remind !== undefined) remind = j.remind; send({ ok: true, person: me }); }); }
  if (u.pathname === '/api/account/transfer') return send({ code: 'K7QM2XR9AB', expiresIn: 900 });
  if (u.pathname === '/api/refresh') return send({ changed: 0 });
  if (u.pathname.startsWith('/api/')) return send({ ok: true });

  if (u.pathname === '/build.txt' && process.env.FAKE_NEW_BUILD) {
    res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('deadbeef99');
  }
  let f = u.pathname === '/' ? '/index.html' : u.pathname;
  const abs = p.join(__dirname, '..', 'public', f);
  if (!fs.existsSync(abs)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[p.extname(abs)] || 'application/octet-stream' });
  res.end(fs.readFileSync(abs));
});
srv.listen(8787, () => console.log('mock on http://127.0.0.1:8787 —', roster.names.length, 'people,', roster.shifts.length, 'shifts'));
