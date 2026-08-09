/* ============================================================
   שבצ"ק — Cloudflare Worker (multi-sheet)

   · sign in with Google once, ever
   · add any שבצ"ק you can already open in Sheets; the worker keeps YOUR
     refresh token for that sheet and polls it forever after
   · to join a sheet someone else added you must prove, with your own
     token, that you can read it — access mirrors Sheets access
   · cron every 5 min per sheet: read (with merges) → parse → diff → push
   ============================================================ */
import '../shared/match.js';
import '../shared/parse.js';
import '../shared/gen.js';
import '../shared/native.js';
const P = globalThis.SHParse;
const N = globalThis.SHNative;

const JSONH = { 'content-type': 'application/json; charset=utf-8' };
const json = (o, s, extra) => new Response(JSON.stringify(o), {
  status: s || 200, headers: Object.assign({}, JSONH, extra || {}),
});
/* The session also rides in an HttpOnly cookie. localStorage alone is not
   durable: Safari's ITP evicts script-writable storage after ~7 idle days, and
   a home-screen app can end up with a different storage bucket than the tab it
   was installed from — both look to the user like "it logged me out". */
const SESSION_COOKIE = sid =>
  `sid=${sid}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax`;
const CLEAR_COOKIE = 'sid=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
function cookieVal(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}
const bad = (m, s) => json({ error: m }, s || 400);
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const rid = () => b64u(crypto.getRandomValues(new Uint8Array(18)));
const DAY = 86400e3;
// Bump when shift keys change meaning. A schema change makes every shift look
// added+removed, so the first poll after one must not notify anybody.
const SCHEMA = 3;

const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const accountId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => ALPHA[b % 32]).join('').replace(/(.{3})(?=.)/g, '$1-');

const sheetIdFrom = s => {
  const m = String(s || '').match(/\/spreadsheets\/d\/([\w-]{20,})/) || String(s || '').match(/^([\w-]{20,})$/);
  return m ? m[1] : null;
};

/* ============================ google ============================ */
async function tokenCall(env, params) {
  const body = new URLSearchParams(Object.assign({
    client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
  }, params));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!r.ok) throw new Error('google: ' + (await r.text()).slice(0, 180));
  return r.json();
}
const exchangeCode = (env, code, redirectUri) => tokenCall(env, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
const accessFrom = async (env, refresh) => (await tokenCall(env, { refresh_token: refresh, grant_type: 'refresh_token' })).access_token;

async function sheetMeta(sheetId, token) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title`,
    { headers: { authorization: 'Bearer ' + token } });
  return r.ok ? (await r.json()).properties : null;
}
// FNV-1a over the raw response. Cheap enough to run every poll, and lets us
// skip JSON.parse + the whole parser when the sheet hasn't been touched.
function hashText(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + t.length;
}
async function readSheet(sheetId, token, prevHash) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?includeGridData=true&fields=` +
    encodeURIComponent('properties.title,sheets(properties(title,sheetId),merges,' +
      'data(rowData(values(formattedValue)),columnMetadata(hiddenByUser),rowMetadata(hiddenByUser)))');
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('sheets ' + r.status + ': ' + (await r.text()).slice(0, 180));
  const text = await r.text();
  const hash = hashText(text);
  if (prevHash && hash === prevHash) return { unchanged: true, hash };
  const doc = JSON.parse(text);
  return {
    hash,
    title: (doc.properties || {}).title || '',
    tabs: (doc.sheets || []).map(sh => {
      const g = (sh.data || [])[0] || {};
      const hid = list => (list || []).reduce((a, m, i) => (m && m.hiddenByUser ? a.concat(i) : a), []);
      return {
        title: sh.properties.title,
        values: (g.rowData || []).map(row => (row.values || []).map(c => (c && c.formattedValue) || '')),
        merges: (sh.merges || []).map(m => ({ r: m.startRowIndex, c: m.startColumnIndex, rs: m.endRowIndex - m.startRowIndex, cs: m.endColumnIndex - m.startColumnIndex })),
        hcols: hid(g.columnMetadata),
        hrows: hid(g.rowMetadata),
      };
    }),
  };
}
/* ---------------- what the widget shows ----------------
   Every word is decided here rather than in Swift. A widget that formats its
   own Hebrew and its own dates is a second copy of rules we already got wrong
   once, in a language we cannot test from here, shipped through a week of App
   Review. So the phone receives finished sentences and two timestamps, and
   draws only the countdown itself. */
function widgetView(env, roster, person, shared, personal) {
  const tz = (roster && roster.tz) || env.TZ_NAME || 'Asia/Jerusalem';
  const now = Date.now();
  const me = P.normKey(resolvePerson(roster, person) || '');
  const out = { at: now, tz, state: 'none', line1: '', line2: '', line3: '', start: 0, end: 0, kind: '', soon: [] };
  if (!me) { out.line1 = 'לא נבחר שם'; out.line3 = 'פתח את האפליקציה'; return out; }

  const hm = t => { const p = P.tzParts(t, tz); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); };
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayOf = t => {
    const a = P.tzParts(t, tz), b = P.tzParts(now, tz);
    const diff = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 86400000);
    if (diff === 0) return 'היום';
    if (diff === 1) return 'מחר';
    const wd = new Date(Date.UTC(a.y, a.mo - 1, a.d)).getUTCDay();
    return 'יום ' + DAYS[wd] + ' ' + a.d + '.' + a.mo;
  };

  const watches = (roster.shifts || [])
    .filter(x => !x.x && P.normKey(x.n) === me)
    .map(x => ({ s: x.s, e: x.e, label: x.p || 'שמירה', kind: 'watch' }));
  const evs = (shared || []).filter(x => N.inAudience(x.to, resolvePerson(roster, person)))
    .concat(personal || [])
    .map(x => ({ s: x.at, e: x.at + (x.mins || 0) * 60000, label: x.text || 'אירוע', kind: 'event' }));

  /* An event you cannot attend is not the next thing you have. Whoever is
     standing a watch across it was never going to be there. */
  const onWatchAt = t => watches.some(w => w.s <= t && t < w.e);
  const items = watches.concat(evs.filter(e => !onWatchAt(e.s))).sort((a, b) => a.s - b.s);

  const current = watches.find(w => w.s <= now && now < w.e);
  const ahead = items.filter(x => x.s > now);
  /* The wide widget lists what comes after the headline. Starting that list at
     the same item the headline already shows reads as a bug, so skip it. */
  const rows = xs => xs.slice(0, 3).map(x => ({ t: x.s, when: dayOf(x.s) + ' ' + hm(x.s), label: x.label, kind: x.kind }));

  if (current) {
    out.soon = rows(ahead);
    out.state = 'on'; out.kind = 'watch';
    out.start = current.s; out.end = current.e;
    out.line1 = 'עד ' + hm(current.e);
    out.line2 = current.label;
    out.line3 = ahead.length ? 'אחר כך ' + dayOf(ahead[0].s) + ' ב-' + hm(ahead[0].s) : 'ואז חופשי';
    return out;
  }
  const nxt = ahead[0];
  out.soon = rows(ahead.slice(1));
  if (!nxt) {
    out.state = 'free';
    out.line1 = 'זמן רפיסה';
    out.line3 = watches.length ? 'אין עוד שמירות' : 'לא נמצאו שיבוצים';
    return out;
  }
  out.state = (nxt.s - now <= 45 * 60000) ? 'soon' : 'free';
  out.kind = nxt.kind;
  out.start = nxt.s; out.end = nxt.e || nxt.s;
  out.line1 = dayOf(nxt.s) + ' ב-' + hm(nxt.s);
  out.line2 = nxt.label;
  out.line3 = nxt.kind === 'watch' && nxt.e > nxt.s ? 'עד ' + hm(nxt.e) : '';
  return out;
}

// how many columns and rows the last parse walked past because the sheet hides them
function hiddenCountOf(roster) {
  const d = (roster && roster.diags) || [];
  return d.reduce((a, x) => a + (((x.hidden || {}).cols) || 0), 0);
}
function idPayload(t) { return JSON.parse(new TextDecoder().decode(unb64u(t.split('.')[1]))); }

/* ============================ storage ============================ */
const getJSON = async (env, k, d) => { const v = await env.SH.get(k); return v ? JSON.parse(v) : (d === undefined ? null : d); };
const putJSON = (env, k, v, o) => env.SH.put(k, JSON.stringify(v), o);

async function session(env, req) {
  const h = req.headers.get('authorization') || '';
  const sid = h.startsWith('Bearer ') ? h.slice(7) : cookieVal(req, 'sid');
  if (!sid) return null;
  const rec = await getJSON(env, 'sid:' + sid);
  return rec ? Object.assign({ sid }, rec) : null;
}
/* drive.file is NON-sensitive: no 100-account cap, no unverified-app screen, no
   Google review. It only grants the files a user hands over through the Picker,
   which is also less access than spreadsheets.readonly gave us.
   Tokens minted under the old sensitive scope keep working — no migration. */
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const canReadSheets = acct => !!(acct.scopes &&
  (acct.scopes.indexOf('drive.file') >= 0 || acct.scopes.indexOf('spreadsheets') >= 0));
const hasSheetsScope = canReadSheets;
const memberKey = (sheetId, account) => 'member:' + sheetId + ':' + account;

async function myAccess(env, acct, sheetId) {
  if (!acct.sheets || !acct.sheets[sheetId]) return false;
  const mem = await getJSON(env, memberKey(sheetId, acct.id));
  if (!mem) return false;                               // revoked, or never joined
  if (mem.via !== 'sheets' || !acct.refresh) return true;
  const st = acct.sheets[sheetId];
  if (st.checkedAt && Date.now() - st.checkedAt < DAY) return true;
  try {                                                  // people who granted the Sheets scope
    const tok = await accessFrom(env, acct.refresh);     // stay gated on the real ACL
    if (await sheetMeta(sheetId, tok)) return true;
    await env.SH.delete(memberKey(sheetId, acct.id));
    return false;
  } catch (e) { return false; }
}
/* A person may have chosen a name that isn't in the sheet yet. Reminders must
   still find them once it appears, without making them re-pick. */
function resolvePerson(roster, person) {
  if (!person || !roster) return person;
  const t = P.normKey(person);
  if ((roster.names || []).some(n => P.normKey(n) === t)) return person;
  const M = globalThis.SHMatch;
  const hit = M && M.rankNames(person, roster.names || [], 1, roster.aliases || {})[0];
  return hit && hit.score >= 0.93 ? hit.name : person;
}

const isOpen = sheet => !!(sheet && sheet.openUntil && Date.now() < sheet.openUntil);
/* KV refuses a ttl under 60s; give the record a minute of grace past the
   advertised expiry so the "כבר פג" message can be shown instead of a 404. */
const ttlUntil = until => Math.max(60, Math.ceil((until - Date.now()) / 1000) + 60);
/* The stored link is only real while it is inside its window AND still in KV. */
async function liveLink(env, sheet) {
  const L = sheet && sheet.link;
  if (!L || !L.code || Date.now() > L.until) return null;
  const gl = await getJSON(env, 'glink:' + L.code);
  if (!gl) return null;
  return { code: L.code, until: L.until, max: L.max || 0, used: gl.used || 0, group: L.group || '' };
}
const isAdmin = (sheet, mem, account) => (sheet && sheet.addedBy === account) || (mem && mem.role === 'admin');

/* ============================ polling ============================ */
async function pollSheet(env, ctx, sheetId, force) {
  const sheet = await getJSON(env, 'sheet:' + sheetId);
  if (!sheet) return { error: 'unknown sheet' };
  // a שבצ"ק built in the app has no upstream to read — it changes only when
  // somebody edits it, and that path notifies on the spot
  if (sheet.kind === 'native') return { unchanged: true, native: true };

  let token = null, usedAccount = sheet.pollAccount;
  try { token = await accessFrom(env, sheet.pollRefresh); }
  catch (e) { token = null; }

  if (!token) {                                          // adder revoked us — promote another member
    const members = await env.SH.list({ prefix: 'member:' + sheetId + ':' });
    for (const k of members.keys) {
      const a = await getJSON(env, 'acct:' + k.name.split(':').pop());
      if (a && !hasSheetsScope(a)) continue;
      if (!a || !a.refresh) continue;
      try {
        const t = await accessFrom(env, a.refresh);
        if (await sheetMeta(sheetId, t)) { token = t; usedAccount = a.id; sheet.pollRefresh = a.refresh; sheet.pollAccount = a.id; break; }
      } catch (e) { }
    }
    if (!token) {
      sheet.lastError = 'אין למי מהמשתמשים גישה לגיליון יותר';
      sheet.lastPoll = Date.now();
      await putJSON(env, 'sheet:' + sheetId, sheet);
      return { error: sheet.lastError };
    }
  }

  const rulesRec = (await getJSON(env, 'rules:' + sheetId)) || { rev: 0, posts: {} };
  const wantV = SCHEMA + ':' + (P.REV || 0) + ':' + (rulesRec.rev || 0);
  const hiddenMode = rulesRec.hidden === 'keep' ? 'keep' : 'skip';

  let doc;
  try { doc = await readSheet(sheetId, token, (!force && sheet.v === wantV) ? sheet.hash : null); }
  catch (e) {
    if (/ 40[13]/.test(e.message)) e = new Error('הגישה לגיליון בוטלה. צריך לבחור אותו שוב מ-Google Drive');
    if (sheet.lastError !== e.message) {          // only write KV when the state actually changes
      sheet.lastError = e.message; sheet.lastPoll = Date.now();
      await putJSON(env, 'sheet:' + sheetId, sheet);
    }
    return { error: e.message };
  }
  if (doc.unchanged) {
    /* No parse and no KV write is the whole point of the hash check. But
       lastPoll then never moves, and the app shows "סונכרן לפני 201 דק׳" for a
       שבצ״ק that is simply unchanged — which reads as "the app is broken" and
       hides the case where it actually is. Stamp it at most twice an hour. */
    if (Date.now() - (sheet.lastPoll || 0) > 30 * 60000) {
      sheet.lastPoll = Date.now(); sheet.lastError = null;
      await putJSON(env, 'sheet:' + sheetId, sheet);
    }
    return { unchanged: true };
  }

  const TZ = env.TZ_NAME || 'Asia/Jerusalem';
  const R = P.parseWorkbook(doc.tabs, { tz: TZ, rules: rulesRec.posts || {}, hidden: hiddenMode });
  const next = {
    id: sheetId, title: doc.title, updatedAt: Date.now(), tz: TZ,
    v: wantV, posts: R.posts, rules: rulesRec.posts || {},
    tabs: R.tabs, scheduleTabs: R.scheduleTabs, names: R.names,
    aliases: R.aliases, locations: R.locations, warnings: R.warnings,
    diags: R.diags || [],
    shifts: R.shifts.map(s => ({ n: s.person || s.name, p: s.post, t: s.tab, s: +s.start, e: +s.end, k: s.key, x: s.aux ? 1 : 0, d: s.src, r: s.row })),
  };
  const prev = await getJSON(env, 'roster:' + sheetId);
  await putJSON(env, 'roster:' + sheetId, next);

  sheet.title = doc.title; sheet.lastPoll = Date.now(); sheet.lastError = null;
  sheet.lastChange = Date.now();
  sheet.hash = doc.hash; sheet.v = wantV;
  sheet.pollAccount = usedAccount; sheet.shiftCount = next.shifts.length; sheet.nameCount = next.names.length;
  await putJSON(env, 'sheet:' + sheetId, sheet);

  return await announce(env, ctx, sheetId, prev, next);
}

/* Diff two roster versions and tell the affected people. Shared by the Sheets
   poller and by in-app edits, so an edit made in the app notifies exactly as a
   Sheets change does — only instantly, since there's nothing to wait for. */
async function announce(env, ctx, sheetId, prev, next) {
  if (!prev) return { first: true, shifts: next.shifts.length };
  if (prev.v !== next.v) return { rebuilt: true, shifts: next.shifts.length };   // schema or rules changed: no storm
  const toShift = a => (a || []).map(x => ({ key: x.k, name: x.n, post: x.p, tab: x.t, start: new Date(x.s), end: new Date(x.e) }));
  const d = P.diff(toShift(prev.shifts), toShift(next.shifts));
  if (!d.added.length && !d.removed.length) return { changed: 0 };

  const stamp = Date.now();
  await putJSON(env, `changes:${sheetId}:${stamp}`, {
    at: stamp, sheet: sheetId,
    byPerson: d.byPerson.map(p => ({
      name: p.name,
      added: p.added.map(s => ({ s: +s.start, e: +s.end, p: s.post, t: s.tab })),
      removed: p.removed.map(s => ({ s: +s.start, e: +s.end, p: s.post, t: s.tab })),
    })),
  }, { expirationTtl: 30 * 86400 });
  await env.SH.put(`changes:${sheetId}:latest`, String(stamp));

  ctx.waitUntil(notify(env, sheetId, new Set(d.byPerson.map(p => P.normKey(p.name)))));
  return { changed: d.added.length + d.removed.length, people: d.byPerson.length };
}

/* Each cron tick handles a slice of the sheets, resuming where the last one
   stopped. Free plan allows 50 subrequests per invocation and each sheet costs
   two, so the batch has to stay well under that. */
async function pollAll(env, ctx) {
  const list = await env.SH.list({ prefix: 'sheet:' });
  const ids = list.keys.map(k => k.name.slice('sheet:'.length)).sort();
  if (!ids.length) return { sheets: 0 };

  const hb = (await getJSON(env, 'poll:hb')) || { cursor: 0, at: 0 };
  const batch = Math.max(1, Math.min(+(env.POLL_BATCH || 20), ids.length));
  const start = (hb.cursor || 0) % ids.length;

  let changed = 0, unchanged = 0, errors = 0;
  for (let i = 0; i < batch; i++) {
    const id = ids[(start + i) % ids.length];
    try {
      const r = await pollSheet(env, ctx, id);
      if (r.error) errors++; else if (r.unchanged) unchanged++; else changed++;
    } catch (e) { errors++; }
  }

  const cursor = (start + batch) % ids.length;
  // heartbeat is throttled: a write every tick would eat the free KV allowance
  if (Date.now() - (hb.at || 0) > 25 * 60000 || changed || errors) {
    await putJSON(env, 'poll:hb', { cursor, at: Date.now(), sheets: ids.length, changed, unchanged, errors });
  }
  return { sheets: ids.length, batch, changed, unchanged, errors };
}

/* ============================ push ============================ */
async function vapidJWT(env, aud) {
  const pub = unb64u(env.VAPID_PUBLIC), priv = unb64u(env.VAPID_PRIVATE);
  const jwk = { kty: 'EC', crv: 'P-256', ext: true, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: b64u(priv) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1e3) + 43200, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}
/* ---------------- Apple's push, for the native app ----------------
   Inside a WKWebView there is no Web Push, so the app registers with Apple and
   we send here as well. The privacy rule does not bend for it: Apple carries a
   placeholder with mutable-content, and the notification service extension in
   the app fetches the real text from /api/notify/ext, exactly as the browser's
   service worker fetches from /api/notify. No name and no hour ever passes
   through Apple. */
let APNS_KEY = null, APNS_JWT = { t: 0, v: '' };
async function apnsJWT(env) {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
  const now = Math.floor(Date.now() / 1000);
  if (APNS_JWT.v && now - APNS_JWT.t < 2400) return APNS_JWT.v;   // Apple rejects a token refreshed too often
  if (!APNS_KEY) {
    const pem = env.APNS_KEY_P8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    APNS_KEY = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })));
  const body = b64u(enc.encode(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, APNS_KEY, enc.encode(head + '.' + body));
  APNS_JWT = { t: now, v: head + '.' + body + '.' + b64u(sig) };
  return APNS_JWT.v;
}
async function pushAPNs(env, account, kind) {
  const rec = await getJSON(env, 'apns:' + account);
  if (!rec || !rec.token) return false;
  const jwt = await apnsJWT(env);
  if (!jwt) return false;
  const host = rec.env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  // A title has to be there or iOS shows nothing at all; the extension replaces it.
  const payload = {
    aps: {
      alert: { title: 'שבצ״ק', body: 'יש עדכון' },
      'mutable-content': 1, sound: 'default', 'thread-id': kind || 'sh',
    },
  };
  try {
    const r = await fetch(`https://${host}/3/device/${rec.token}`, {
      method: 'POST',
      headers: {
        authorization: 'bearer ' + jwt,
        'apns-topic': rec.bundle || env.APNS_BUNDLE_ID || 'com.shavtzak.app',
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    // 410 means the app was deleted; stop writing to a dead token
    if (r.status === 410) await env.SH.delete('apns:' + account);
    return r.ok;
  } catch (e) { return false; }
}

/* ---------------- Google's push, for the Android app ----------------
   Same shape as APNs and for the same reason: the message Google carries is
   empty, and the app fetches the text from /api/notify/ext. FCM's modern API
   wants an OAuth token, so a service account JWT is traded for one and kept
   until it is nearly stale. */
let FCM_KEY = null, FCM_TOK = { t: 0, v: '', project: '' };
async function fcmAccess(env) {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  const now = Math.floor(Date.now() / 1000);
  if (FCM_TOK.v && now < FCM_TOK.t - 120) return FCM_TOK;
  let sa;
  try { sa = JSON.parse(env.FCM_SERVICE_ACCOUNT); } catch (e) { return null; }
  if (!sa.private_key || !sa.client_email || !sa.project_id) return null;
  if (!FCM_KEY) {
    const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    FCM_KEY = await crypto.subtle.importKey('pkcs8', der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', FCM_KEY, enc.encode(head + '.' + body));
  const assertion = head + '.' + body + '.' + b64u(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  FCM_TOK = { t: now + (j.expires_in || 3600), v: j.access_token, project: sa.project_id };
  return FCM_TOK;
}
async function pushFCM(env, account, kind) {
  const rec = await getJSON(env, 'fcm:' + account);
  if (!rec || !rec.token) return false;
  const tok = await fcmAccess(env);
  if (!tok) return false;
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${tok.project}/messages:send`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + tok.v, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: rec.token,
          // data only: no title and no body ever leave here
          data: { kind: String(kind || 'change') },
          android: { priority: 'HIGH', ttl: '3600s' },
        },
      }),
    });
    if (r.status === 404 || r.status === 403) await env.SH.delete('fcm:' + account);
    return r.ok;
  } catch (e) { return false; }
}

async function pushAccount(env, account, notif) {
  // The push itself carries no payload — names and times never pass through
  // Apple's or Google's servers. The worker parks the text here and the service
  // worker fetches it over an authenticated connection.
  if (notif) await putJSON(env, 'notif:' + account, notif, { expirationTtl: 3600 });
  const kind = notif && notif.kind;
  let sent = await pushAPNs(env, account, kind);
  if (await pushFCM(env, account, kind)) sent = true;
  const rec = await getJSON(env, 'sub:' + account);
  if (!rec || !rec.sub) return sent;
  try {
    const jwt = await vapidJWT(env, new URL(rec.sub.endpoint).origin);
    const res = await fetch(rec.sub.endpoint, { method: 'POST',
      headers: { TTL: '86400', Urgency: 'normal', 'Content-Length': '0', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}` } });
    if (res.status === 404 || res.status === 410 || res.status === 403) {
      await env.SH.delete('sub:' + account);
      return sent;
    }
    return true;
  } catch (e) { return sent; }
}
async function notify(env, sheetId, affected) {
  /* Both kinds of subscriber, once each. Somebody who has only the app has an
     apns: record and no sub:, and walking only one prefix is how a person stops
     hearing about their own שבצ״ק without anyone noticing. */
  const seen = new Set();
  const subs = await env.SH.list({ prefix: 'sub:' });
  const ios = await env.SH.list({ prefix: 'apns:' });
  const android = await env.SH.list({ prefix: 'fcm:' });
  const accounts = [];
  for (const k of subs.keys.concat(ios.keys, android.keys)) {
    const account = k.name.split(':').pop();
    if (seen.has(account)) continue;
    seen.add(account); accounts.push(account);
  }
  const rosterNow = await getJSON(env, 'roster:' + sheetId);
  for (const account of accounts) {
    const acct = await getJSON(env, 'acct:' + account);
    const me = acct && acct.sheets && acct.sheets[sheetId] &&
      resolvePerson(rosterNow, acct.sheets[sheetId].person);
    if (!me || !affected.has(P.normKey(me))) continue;
    await putJSON(env, 'notif:' + account, { kind: 'change', sheet: sheetId }, { expirationTtl: 3600 });
    await pushAPNs(env, account, 'change');
    await pushFCM(env, account, 'change');
    const rec = await getJSON(env, 'sub:' + account);
    if (!rec || !rec.sub) continue;
    try {
      const res = await fetch(rec.sub.endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: 'high', 'Content-Length': '0',
                   Authorization: `vapid t=${await vapidJWT(env, new URL(rec.sub.endpoint).origin)}, k=${env.VAPID_PUBLIC}` },
      });
      /* 403 here means the subscription was made with a VAPID key we no
         longer hold. Dropping it is what makes the app ask for a new one on
         the next open; keeping it means silence forever. */
      if (res.status === 404 || res.status === 410 || res.status === 403) await env.SH.delete('sub:' + account);
    } catch (e) { }
  }
}

/* ---------------------- pre-shift reminders ----------------------
   Runs every tick for everyone subscribed, independent of the polling
   round-robin: a reminder that arrives late is worthless. */
async function remindAll(env, ctx) {
  // everyone who can receive anything: browser subscribers and app installs
  const seen = new Set();
  for (const pre of ['sub:', 'apns:', 'fcm:']) {
    const l = await env.SH.list({ prefix: pre });
    for (const k of l.keys) seen.add(k.name.split(':').pop());
  }
  if (!seen.size) return { reminded: 0 };
  const rosters = new Map();                       // one read per sheet per tick
  const now = Date.now();
  let sent = 0;

  for (const account of seen) {
    const rec = { account };
    const acct = await getJSON(env, 'acct:' + account);
    if (!acct || !acct.sheets) continue;

    for (const [sheetId, st] of Object.entries(acct.sheets)) {
      const lead = +(st.remind || 0);
      if (!lead || !st.person) continue;

      if (!rosters.has(sheetId)) rosters.set(sheetId, await getJSON(env, 'roster:' + sheetId));
      const roster = rosters.get(sheetId);
      if (!roster) continue;

      const me = P.normKey(resolvePerson(roster, st.person));

      /* Announced events and personal notes, for whoever isn't standing a
         watch across them — you can't be told to be in two places. */
      const person = resolvePerson(roster, st.person);
      const evs = ((await getJSON(env, 'events:' + sheetId)) || []).filter(x => N.inAudience(x.to, person))
        .concat(((await getJSON(env, 'pev:' + rec.account + ':' + sheetId)) || []).map(x => Object.assign({}, x, { mine: 1 })));
      for (const evt of evs) {
        if (evt.at <= now) continue;
        const inMins = Math.round((evt.at - now) / 60000);
        if (inMins > lead) continue;
        const end = evt.at + (evt.mins || 0) * 60000;
        if (!evt.mine && roster.shifts.some(x => !x.x && P.normKey(x.n) === me && x.s <= evt.at && x.e > evt.at)) continue;
        const seenE = 'rem:' + rec.account + ':ev:' + evt.id;
        if (await env.SH.get(seenE)) continue;
        await env.SH.put(seenE, '1', { expirationTtl: 6 * 3600 });
        ctx.waitUntil(pushAccount(env, rec.account, {
          kind: 'event', sheet: sheetId, mins: inMins, text: evt.text, start: evt.at, end,
        }));
        sent++;
      }

      const next = roster.shifts
        .filter(x => !x.x && P.normKey(x.n) === me && x.s > now)
        .sort((a, b) => a.s - b.s)[0];
      if (!next) continue;

      const mins = Math.round((next.s - now) / 60000);
      if (mins > lead) continue;                   // not yet
      const seen = 'rem:' + rec.account + ':' + next.k;
      if (await env.SH.get(seen)) continue;        // already told them
      await env.SH.put(seen, '1', { expirationTtl: 6 * 3600 });

      const withMe = [...new Set(roster.shifts
        .filter(x => x.s === next.s && x.p === next.p && P.normKey(x.n) !== me)
        .map(x => x.n))];
      ctx.waitUntil(pushAccount(env, rec.account, {
        kind: 'reminder', sheet: sheetId, mins,
        post: next.p || '', start: next.s, end: next.e, withMe,
      }));
      sent++;
    }
  }
  return { reminded: sent };
}

/* ============================ api ============================ */
async function api(req, env, ctx, url) {
  const path = url.pathname;

  if (path === '/api/config') {
    return json({
      version: '3.1.0', clientId: env.GOOGLE_CLIENT_ID, vapidPublic: env.VAPID_PUBLIC,
      defaultSheet: env.SHEET_ID || '',
      pickerApiKey: env.PICKER_API_KEY || '', appId: env.GOOGLE_PROJECT_NUMBER || '',
      driveScope: DRIVE_FILE,
    });
  }

  if (path === '/api/auth' && req.method === 'POST') {
    const { code, redirectUri } = await req.json();
    if (!code) return bad('missing code');
    const tok = await exchangeCode(env, code, redirectUri);
    const who = idPayload(tok.id_token);
    if (!who.email_verified) return bad('email not verified', 403);

    const key = 'acct:email:' + who.email;
    let id = await env.SH.get(key);
    if (!id) { id = accountId(); await env.SH.put(key, id); }
    const acct = (await getJSON(env, 'acct:' + id)) || { id, email: who.email, sheets: {}, created: Date.now() };
    acct.name = who.name || acct.name;
    acct.scopes = tok.scope || acct.scopes || '';
    if (tok.refresh_token) acct.refresh = tok.refresh_token;
    await putJSON(env, 'acct:' + id, acct);

    const sid = rid();
    await putJSON(env, 'sid:' + sid, { account: id, email: who.email });   // no TTL: sign in once
    return json({
      sid, account: id, email: who.email, name: who.name, sheets: sheetList(acct),
      // the Picker runs in the browser and needs its own token; ~1h, never stored
      pickerToken: (tok.scope || '').indexOf('drive.file') >= 0 ? tok.access_token : null,
      canPick: canReadSheets(acct),
    }, 200, { 'set-cookie': SESSION_COOKIE(sid) });
  }

  /* ---------------- the iOS widget ----------------
     A widget on the home screen runs on its own, in its own process, while
     nobody is looking. It gets its own token rather than the session: the
     token is revocable on its own, it can only reach this one endpoint, and
     the answer is one line of text — never the roster. */
  if (path === '/api/widget' || path === '/api/notify/ext' ||
      path === '/api/apns/register' || path === '/api/fcm/register') {
    const h = req.headers.get('authorization') || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('t') || '';
    const rec = tok && tok.startsWith('wt_') ? await getJSON(env, 'wtok:' + tok) : null;
    if (!rec) return bad('unauthorised', 401);

    /* The notification service extension asks what the push was really about.
       Same rule as the browser's service worker: Apple carries a placeholder,
       the text comes over this connection. */
    if (path === '/api/notify/ext') {
      const n = await getJSON(env, 'notif:' + rec.account);
      if (n) await env.SH.delete('notif:' + rec.account);
      return json(n || { kind: 'none' });
    }
    if (path === '/api/fcm/register') {
      if (req.method !== 'POST') return bad('POST only', 405);
      const b = await req.json().catch(() => ({}));
      const dev = String(b.token || '').trim();
      if (dev.length < 20 || dev.length > 400) return bad('bad device token');
      await putJSON(env, 'fcm:' + rec.account, { account: rec.account, token: dev, at: Date.now() });
      return json({ ok: true });
    }
    if (path === '/api/apns/register') {
      if (req.method !== 'POST') return bad('POST only', 405);
      const b = await req.json().catch(() => ({}));
      const dev = String(b.token || '').replace(/[^0-9a-f]/gi, '');
      if (dev.length < 60) return bad('bad device token');
      await putJSON(env, 'apns:' + rec.account, {
        account: rec.account, token: dev,
        env: b.env === 'sandbox' ? 'sandbox' : 'production',
        bundle: String(b.bundle || env.APNS_BUNDLE_ID || 'com.shavtzak.app'),
        at: Date.now(),
      });
      return json({ ok: true });
    }

    const a = await getJSON(env, 'acct:' + rec.account);
    if (!a || !a.sheets) return json({ state: 'none', line1: 'אין שבצ״ק' });
    const id = rec.sheet && a.sheets[rec.sheet] ? rec.sheet : (a.active || Object.keys(a.sheets)[0]);
    const r = id ? await getJSON(env, 'roster:' + id) : null;
    if (!r) return json({ state: 'none', line1: 'אין שבצ״ק' });
    // keep the token warm so a widget that is actually on a screen never expires
    if (Date.now() - (rec.seen || 0) > 86400000) {
      rec.seen = Date.now();
      await putJSON(env, 'wtok:' + tok, rec, { expirationTtl: 400 * 86400 });
    }
    return json(widgetView(env, r, a.sheets[id] && a.sheets[id].person,
      (await getJSON(env, 'events:' + id)) || [],
      (await getJSON(env, 'pev:' + rec.account + ':' + id)) || []));
  }

  const s = await session(env, req);
  if (path === '/api/session') {
    if (!s) return bad('unauthorised', 401);
    // hand the client a token again so it works even where cookies are blocked
    return json({ sid: s.sid, account: s.account, email: s.email || null });
  }
  if (!s) return bad('unauthorised', 401);
  const acctKey = 'acct:' + s.account;
  const acct = (await getJSON(env, acctKey)) || { id: s.account, sheets: {} };
  acct.sheets = acct.sheets || {};

  if (path === '/api/sheets' && req.method === 'GET') {
    const out = [];
    for (const id of Object.keys(acct.sheets)) {
      const sh = await getJSON(env, 'sheet:' + id);
      let pending = 0;
      if (sh && isAdmin(sh, await getJSON(env, memberKey(id, s.account)), s.account)) {
        pending = (await env.SH.list({ prefix: 'req:' + id + ':' })).keys.length;
      }
      out.push({
        id, title: (sh && sh.title) || '', kind: (sh && sh.kind) || 'sheets',
        person: acct.sheets[id].person || null,
        lastPoll: sh && sh.lastPoll, lastChange: sh && sh.lastChange, lastError: sh && sh.lastError,
        shiftCount: sh && sh.shiftCount, nameCount: sh && sh.nameCount, pending,
        openUntil: (sh && sh.openUntil) || 0,
      });
    }
    return json({ sheets: out, active: acct.active || out[0] && out[0].id || null });
  }

  if (path === '/api/sheets/add' && req.method === 'POST') {
    const body0 = await req.json();
    const sheetId = body0.id ? String(body0.id) : sheetIdFrom(body0.url);
    const fromPicker = !!body0.id;
    if (!sheetId) return bad('זה לא נראה כמו קישור לגיליון Google Sheets');

    let sheet = await getJSON(env, 'sheet:' + sheetId);

    /* Someone else already connected this שבצ"ק. Do NOT make this person grant
       the Sheets scope: every such consent burns one of Google's permanent 100
       and shows them the unverified-app screen. Pasting the link is the natural
       thing to do, so it turns into a join request instead. */
    if (sheet && !acct.sheets[sheetId]) {
      const already = await getJSON(env, memberKey(sheetId, s.account));
      if (!already && isOpen(sheet)) {                    // מצב פתוח: straight in
        await putJSON(env, memberKey(sheetId, s.account), {
          account: s.account, email: acct.email, name: acct.name || '',
          joinedAt: Date.now(), via: 'open', role: 'member',
        });
      } else if (!already) {
        await putJSON(env, 'req:' + sheetId + ':' + s.account, {
          account: s.account, email: acct.email, name: acct.name || '', at: Date.now(),
        }, { expirationTtl: 30 * 86400 });
        ctx.waitUntil(pushAccount(env, sheet.addedBy));
        return json({ pending: true, id: sheetId, title: sheet.title });
      }
      acct.sheets[sheetId] = acct.sheets[sheetId] || { person: null, checkedAt: Date.now() };
      acct.active = sheetId;
      await putJSON(env, acctKey, acct);
      return json({ ok: true, id: sheetId, title: sheet.title });
    }

    // genuinely new sheet — the only case that needs Drive access at all
    if (!canReadSheets(acct) || !acct.refresh) {
      return json({ error: 'צריך לבחור את הגיליון מ-Google Drive', needPicker: true }, 428);
    }
    let meta = null;
    try { meta = await sheetMeta(sheetId, await accessFrom(env, acct.refresh)); } catch (e) { }
    if (!meta) {
      return json({
        error: fromPicker
          ? 'הגישה לגיליון לא נרשמה. נסה לבחור אותו שוב.'
          : 'הגיליון הזה עדיין לא חובר. בחר אותו מ-Google Drive.',
        needPicker: true,
      }, 403);
    }

    if (!sheet) sheet = { id: sheetId, title: meta.title, addedBy: s.account, pollAccount: s.account, pollRefresh: acct.refresh, addedAt: Date.now() };
    else if (!sheet.pollRefresh) { sheet.pollRefresh = acct.refresh; sheet.pollAccount = s.account; }
    await putJSON(env, 'sheet:' + sheetId, sheet);
    await putJSON(env, memberKey(sheetId, s.account), {
      account: s.account, email: acct.email, name: acct.name || '',
      joinedAt: Date.now(), via: 'sheets', role: sheet.addedBy === s.account ? 'admin' : 'member',
    });

    acct.sheets[sheetId] = acct.sheets[sheetId] || { person: null, checkedAt: Date.now() };
    acct.sheets[sheetId].checkedAt = Date.now();
    acct.active = sheetId;
    await putJSON(env, acctKey, acct);

    if (!(await env.SH.get('roster:' + sheetId))) await pollSheet(env, ctx, sheetId);
    return json({ ok: true, id: sheetId, title: meta.title });
  }

  /* Leaving has three consequences people don't think about, so the server
     handles all three rather than leaving a half-orphaned שבצ"ק behind:
     the owner walking out, the poll token walking out, and the last person
     out of a native roster taking the only copy of it with them. */
  if (path === '/api/sheets/leave' && req.method === 'POST') {
    const body = await req.json();
    const id = body.id;
    const sheet = await getJSON(env, 'sheet:' + id);
    const others = (await env.SH.list({ prefix: 'member:' + id + ':' })).keys
      .map(k => k.name.split(':').pop()).filter(a => a !== s.account);

    // last one out of a שבצ"ק that lives only here: say so before deleting it
    if (sheet && !others.length && !body.confirm) {
      return json({
        needConfirm: true,
        error: sheet.kind === 'native'
          ? 'אתה האחרון בשבצ״ק הזה. אם תצא הוא יימחק לגמרי, הוא קיים רק כאן.'
          : 'אתה האחרון בשבצ״ק הזה. אם תצא הוא יוסר מהאפליקציה, הגיליון עצמו לא ייפגע.',
      }, 409);
    }

    delete acct.sheets[id];
    if (acct.active === id) acct.active = Object.keys(acct.sheets)[0] || null;
    await putJSON(env, acctKey, acct);
    await env.SH.delete(memberKey(id, s.account));

    if (!sheet) return json({ ok: true });

    if (!others.length) {                                  // nobody left: clean up after it
      for (const pre of ['req:' + id + ':', 'changes:' + id + ':']) {
        const l = await env.SH.list({ prefix: pre });
        for (const k of l.keys) await env.SH.delete(k.name);
      }
      if (sheet.link && sheet.link.code) await env.SH.delete('glink:' + sheet.link.code);
      await env.SH.delete('roster:' + id);
      await env.SH.delete('rules:' + id);
      await env.SH.delete('contacts:' + id);
      await env.SH.delete('bcast:' + id);
      await env.SH.delete('groups:' + id);
      await env.SH.delete('events:' + id);
      await env.SH.delete('native:' + id);
      await env.SH.delete('sheet:' + id);
      return json({ ok: true, deleted: true });
    }

    let handover = null;
    if (sheet.addedBy === s.account) {
      /* Ownership can't just evaporate — without an owner nobody can approve a
         request or hand out a link. Prefer an admin, else whoever joined first. */
      let pick = null, first = null;
      for (const a of others) {
        const m = await getJSON(env, memberKey(id, a));
        if (!m) continue;
        if (!first || (m.joinedAt || 0) < (first.joinedAt || 0)) first = m;
        if (m.role === 'admin' && !pick) pick = m;
      }
      const heir = pick || first;
      if (heir) {
        sheet.addedBy = heir.account;
        heir.role = 'admin';
        await putJSON(env, memberKey(id, heir.account), heir);
        handover = heir.name || heir.email || heir.account;
        ctx.waitUntil(pushAccount(env, heir.account));
      }
    }
    // the sheet was being read with MY token — drop it and let the next poll
    // promote somebody who still has access
    if (sheet.pollAccount === s.account) { sheet.pollRefresh = null; sheet.pollAccount = null; }
    await putJSON(env, 'sheet:' + id, sheet);
    return json({ ok: true, handover });
  }

  const sheetParam = url.searchParams.get('sheet') || acct.active || Object.keys(acct.sheets)[0];

  if (path === '/api/roster') {
    if (!sheetParam) return json({ empty: true });
    if (!(await myAccess(env, acct, sheetParam))) {
      delete acct.sheets[sheetParam];
      await putJSON(env, acctKey, acct);
      return bad('הגישה שלך לגיליון הוסרה', 403);
    }
    acct.sheets[sheetParam].checkedAt = Date.now();
    acct.active = sheetParam;
    await putJSON(env, acctKey, acct);

    let r = await getJSON(env, 'roster:' + sheetParam);
    if (!r) { await pollSheet(env, ctx, sheetParam); r = await getJSON(env, 'roster:' + sheetParam); }
    if (!r) return bad('לא הצלחתי לקרוא את הגיליון', 503);
    r.me = acct.sheets[sheetParam].person || null;
    r.nicknames = acct.sheets[sheetParam].nicknames || [];
    r.remind = acct.sheets[sheetParam].remind || 0;
    r.lastSeen = acct.sheets[sheetParam].lastSeen || 0;
    r.account = s.account;
    const shRec = await getJSON(env, 'sheet:' + sheetParam);
    r.lastPoll = (shRec && shRec.lastPoll) || 0;          // when the worker last LOOKED
    r.lastChange = (shRec && shRec.lastChange) || r.updatedAt || 0;
    r.lastError = (shRec && shRec.lastError) || null;
    const hb = await getJSON(env, 'poll:hb');
    r.lastTick = (hb && hb.at) || 0;                      // when the cron last ran at all
    r.contacts = (await getJSON(env, 'contacts:' + sheetParam)) || [];
    r.groups = (await getJSON(env, 'groups:' + sheetParam)) || [];
    /* Audience filtering happens here, not in the app: a לוז for פיקוד must not
       be sitting in everyone else's payload, and a personal note must never
       leave its own key. */
    {
      const mePerson = resolvePerson(r, acct.sheets[sheetParam].person);
      const shared = ((await getJSON(env, 'events:' + sheetParam)) || [])
        .filter(x => N.inAudience(x.to, mePerson));
      const own = ((await getJSON(env, 'pev:' + s.account + ':' + sheetParam)) || [])
        .map(x => Object.assign({}, x, { mine: 1 }));
      r.events = shared.concat(own).sort((a, b) => a.at - b.at).slice(0, 200);
    }
    /* Filtered here rather than in the app: a message sent to פיקוד should not
       be sitting in everyone else's roster payload waiting to be read. */
    const bcRec = await getJSON(env, 'bcast:' + sheetParam);
    r.bcast = (!bcRec || bcRec.by === s.account ||
      N.inAudience(bcRec.to, resolvePerson(r, acct.sheets[sheetParam].person))) ? bcRec : null;
    return json(r);
  }

  if (path === '/api/me' && req.method === 'POST') {
    const b = await req.json();
    const id = b.sheet || sheetParam;
    if (!id || !acct.sheets[id]) return bad('sheet not joined', 404);
    if (b.person !== undefined) {
      acct.sheets[id].person = b.person;
      /* Joined through a squad link: now that there is a name, put it in the
         squad. Once only — after that the group is edited like any other. */
      const mem2 = await getJSON(env, memberKey(id, s.account));
      if (mem2 && mem2.joinGroup && b.person) {
        const groups = (await getJSON(env, 'groups:' + id)) || [];
        const g = groups.find(x => P.normKey(x.name) === P.normKey(mem2.joinGroup));
        if (g && !g.people.some(x => P.normKey(x) === P.normKey(b.person))) {
          g.people.push(b.person);
          await putJSON(env, 'groups:' + id, groups);
        }
        delete mem2.joinGroup;
        await putJSON(env, memberKey(id, s.account), mem2);
      }
    }
    if (b.nicknames !== undefined) acct.sheets[id].nicknames = b.nicknames;
    if (b.remind !== undefined) acct.sheets[id].remind = Math.max(0, Math.min(+b.remind || 0, 240));
    if (b.seen) acct.sheets[id].lastSeen = Date.now();
    await putJSON(env, acctKey, acct);
    return json({ ok: true, person: acct.sheets[id].person || null });
  }

  if (path === '/api/notify') {                    // the service worker asks what to show
    const n = await getJSON(env, 'notif:' + s.account);
    if (n) await env.SH.delete('notif:' + s.account);
    return json(n || { kind: 'none' });
  }

  /* The number for the app icon. Deliberately the smallest answer we can give:
     a count and the next start time, for one person, on one שבצ״ק. The service
     worker calls this while the app is closed, so it must never hand back the
     roster. */
  if (path === '/api/badge') {
    const id = sheetParam;
    if (!id || !acct.sheets[id]) return json({ n: 0 });
    const r = await getJSON(env, 'roster:' + id);
    if (!r) return json({ n: 0 });
    const me = P.normKey(resolvePerson(r, acct.sheets[id].person) || '');
    if (!me) return json({ n: 0 });
    const now = Date.now();
    const mine = (r.shifts || []).filter(x => !x.x && P.normKey(x.n) === me && x.e > now && x.s < now + 86400000);
    const next = mine.filter(x => x.s > now).sort((a, b) => a.s - b.s)[0] || null;
    return json({ n: mine.length, next: next ? next.s : 0, on: mine.some(x => x.s <= now) ? 1 : 0 });
  }

  /* The native app asks for a widget token once, right after sign-in, and
     hands it to the widget through the shared app group. Deleting it here kills
     the widget everywhere without touching the session. */
  if (path === '/api/widget/token') {
    if (req.method !== 'POST') {
      const cur = await getJSON(env, 'wtokof:' + s.account);
      return json({ token: cur ? cur.token : null });
    }
    const body = await req.json().catch(() => ({}));
    const old = await getJSON(env, 'wtokof:' + s.account);
    if (old && old.token) await env.SH.delete('wtok:' + old.token);
    if (body.revoke) { await env.SH.delete('wtokof:' + s.account); return json({ ok: true, token: null }); }
    const token = 'wt_' + rid();
    const rec = { account: s.account, sheet: sheetParam || null, at: Date.now(), seen: Date.now() };
    await putJSON(env, 'wtok:' + token, rec, { expirationTtl: 400 * 86400 });
    await putJSON(env, 'wtokof:' + s.account, { token, at: Date.now() });
    return json({ ok: true, token });
  }

  if (path === '/api/changes') {
    if (!sheetParam) return json({ at: 0, mine: null });
    const latest = await env.SH.get(`changes:${sheetParam}:latest`);
    if (!latest) return json({ at: 0, mine: null });
    const c = await getJSON(env, `changes:${sheetParam}:${latest}`, {});
    const rosterNow = await getJSON(env, 'roster:' + sheetParam);
    const me = acct.sheets[sheetParam] && resolvePerson(rosterNow, acct.sheets[sheetParam].person);
    const mine = me ? (c.byPerson || []).find(p => P.normKey(p.name) === P.normKey(me)) : null;
    return json({ at: c.at || 0, mine: mine || null, total: (c.byPerson || []).length });
  }

  if (path === '/api/push/subscribe' && req.method === 'POST') {
    const { subscription } = await req.json();
    if (!subscription || !subscription.endpoint) return bad('missing subscription');
    await putJSON(env, 'sub:' + s.account, { account: s.account, sub: subscription, at: Date.now() });
    return json({ ok: true });
  }
  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    await env.SH.delete('sub:' + s.account);
    return json({ ok: true });
  }

  if (path === '/api/sheets/invite' && req.method === 'POST') {
    const invBody = await req.json();
    const { sheet: sid, count } = invBody;
    const inviteGroup = String(invBody.group || '').trim().slice(0, 40);
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('רק מי שהוסיף את הגיליון יכול להזמין', 403);
    const n = Math.min(Math.max(1, +count || 1), 40);
    const codes = [];
    for (let i = 0; i < n; i++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ALPHA[b % 32]).join('');
      await putJSON(env, 'invite:' + code, { sheet: id, by: s.account, at: Date.now(), group: inviteGroup }, { expirationTtl: 30 * 86400 });
      codes.push(code);
    }
    return json({ codes, sheet: id, title: sheet.title });
  }

  /* One link, many people, expires on its own. The single-use codes above are
     right for adding one person; this is for pasting into a platoon's WhatsApp.
     It always carries an expiry — a link with no clock is a link that leaks. */
  if (path === '/api/sheets/link') {
    const body = req.method === 'POST' ? await req.json() : {};
    const id = body.sheet || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);

    if (req.method !== 'POST') return json({ link: await liveLink(env, sheet) });

    const mins = Math.max(0, Math.min(+body.minutes || 0, 30 * 1440));
    if (sheet.link && sheet.link.code) await env.SH.delete('glink:' + sheet.link.code);
    if (!mins) {                                          // revoke
      sheet.link = null;
      await putJSON(env, 'sheet:' + id, sheet);
      return json({ link: null });
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHA[b % 32]).join('');
    const until = Date.now() + mins * 60000;
    const max = Math.max(0, Math.min(+body.max || 0, 500));   // 0 = no cap
    /* A link can carry a squad. You can't be added to פיקוד at redeem time —
       you haven't said who you are yet — so it's remembered on the membership
       and applied the moment you pick your name. */
    const group = String(body.group || '').trim().slice(0, 40);
    await putJSON(env, 'glink:' + code, { sheet: id, by: s.account, at: Date.now(), until, max, used: 0, group },
      { expirationTtl: ttlUntil(until) });
    sheet.link = { code, until, max, group };
    await putJSON(env, 'sheet:' + id, sheet);
    return json({ link: { code, until, max, used: 0 } });
  }

  if (path === '/api/sheets/join' && req.method === 'POST') {
    const { code } = await req.json();
    const norm = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    let target = null, via = 'invite', by = null, joinGroup = '';

    const inv = await getJSON(env, 'invite:' + norm);
    if (inv) {
      await env.SH.delete('invite:' + norm);             // single use, burns on redeem
      target = inv.sheet; by = inv.by; joinGroup = inv.group || '';
    } else {
      const gl = norm && await getJSON(env, 'glink:' + norm);
      if (!gl) return bad('ההזמנה לא תקפה או שכבר נוצלה', 404);
      if (Date.now() > gl.until) { await env.SH.delete('glink:' + norm); return bad('הקישור הזה כבר פג', 410); }
      const already = await getJSON(env, memberKey(gl.sheet, s.account));
      if (!already && gl.max && (gl.used || 0) >= gl.max) return bad('הקישור הזה נוצל במלואו', 410);
      target = gl.sheet; by = gl.by; via = 'link'; joinGroup = gl.group || '';
      // best effort: KV has no atomic increment, so a burst can overshoot the
      // cap by a few. The expiry, not the counter, is what actually closes it.
      if (!already) { gl.used = (gl.used || 0) + 1; await putJSON(env, 'glink:' + norm, gl, { expirationTtl: ttlUntil(gl.until) }); }
    }

    const sheet = await getJSON(env, 'sheet:' + target);
    if (!sheet) return bad('הגיליון לא קיים יותר', 404);
    if (!(await getJSON(env, memberKey(target, s.account)))) {
      await putJSON(env, memberKey(target, s.account), {
        account: s.account, email: acct.email, name: acct.name || '',
        joinedAt: Date.now(), via, invitedBy: by, role: 'member', joinGroup,
      });
    }
    acct.sheets[target] = acct.sheets[target] || { person: null };
    acct.sheets[target].checkedAt = Date.now();
    acct.active = target;
    await putJSON(env, acctKey, acct);
    return json({ ok: true, id: target, title: sheet.title });
  }

  /* ---------------- שבצ"ק built inside the app ----------------
     No Google Sheet behind it: the document lives in KV and the editor is the
     only writer. Everything else — membership, invites, search, reminders,
     change pushes — is the same code path as a Sheets-backed one. */
  if (path === '/api/native/create' && req.method === 'POST') {
    const body = await req.json();
    const id = 'n_' + rid().replace(/[^A-Za-z0-9]/g, '').slice(0, 22);
    const doc = N.sanitise(Object.assign({}, body.doc || {}, { id, tz: env.TZ_NAME || 'Asia/Jerusalem' }));
    if (!doc.title) return bad('צריך שם לשבצ״ק');
    const sheet = {
      id, kind: 'native', title: doc.title, addedBy: s.account, addedAt: Date.now(),
      lastPoll: Date.now(), shiftCount: 0, nameCount: doc.people.length,
    };
    await putJSON(env, 'sheet:' + id, sheet);
    await putJSON(env, memberKey(id, s.account), {
      account: s.account, email: acct.email, name: acct.name || '',
      joinedAt: Date.now(), via: 'created', role: 'admin',
    });
    await putJSON(env, 'native:' + id, doc);
    const roster = N.compile(doc, { tz: env.TZ_NAME });
    roster.v = SCHEMA + ':native';
    await putJSON(env, 'roster:' + id, roster);
    sheet.shiftCount = roster.shifts.length;
    await putJSON(env, 'sheet:' + id, sheet);
    acct.sheets[id] = { person: null, checkedAt: Date.now() };
    acct.active = id;
    await putJSON(env, acctKey, acct);
    return json({ ok: true, id, title: doc.title });
  }

  if (path === '/api/native') {
    const body = req.method === 'POST' ? await req.json() : {};
    const id = body.sheet || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    if (!sheet || sheet.kind !== 'native') return bad('לא שבצ״ק של האפליקציה', 404);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!(await myAccess(env, acct, id))) return bad('אין לך הרשאה', 403);
    const admin = isAdmin(sheet, mem, s.account);

    if (req.method !== 'POST') {
      const doc = (await getJSON(env, 'native:' + id)) || N.emptyDoc({ id, title: sheet.title });
      return json({ doc, admin });
    }
    if (!admin) return bad('רק מנהל יכול לערוך את השבצ״ק', 403);

    const cur = (await getJSON(env, 'native:' + id)) || N.emptyDoc({ id, title: sheet.title });
    /* Two admins editing at once would otherwise silently overwrite each other.
       The editor sends the rev it loaded; a stale one is refused, not merged. */
    if (body.rev != null && +body.rev !== (cur.rev || 0)) {
      return json({ error: 'מישהו אחר ערך את השבצ״ק בינתיים. רענן ונסה שוב.', stale: true, doc: cur }, 409);
    }
    const doc = N.sanitise(Object.assign({}, body.doc || {}, { id, tz: env.TZ_NAME || 'Asia/Jerusalem' }));
    doc.rev = (cur.rev || 0) + 1;
    doc.updatedAt = Date.now(); doc.updatedBy = s.account;
    await putJSON(env, 'native:' + id, doc);

    const next = N.compile(doc, { tz: env.TZ_NAME });
    next.v = SCHEMA + ':native';
    const prev = await getJSON(env, 'roster:' + id);
    await putJSON(env, 'roster:' + id, next);
    sheet.title = doc.title; sheet.lastPoll = Date.now(); sheet.lastError = null;
    sheet.shiftCount = next.shifts.length; sheet.nameCount = next.names.length;
    await putJSON(env, 'sheet:' + id, sheet);

    const out = await announce(env, ctx, id, prev, next);
    return json({ ok: true, rev: doc.rev, shifts: next.shifts.length, changed: out.changed || 0 });
  }

  /* Who to call. Kept beside the שבצ״ק rather than in it: the officers on this
     list are rarely the people standing the watches, and the חמל wants it
     visible to whoever is at the gate at 03:00 — so every member reads it and
     only an admin writes it. */
  /* ---------------- events ----------------
     One mechanism behind three things: a message with an hour on it, a whole
     לוז pasted in at once, and a note somebody keeps for himself. They differ
     only in who can see them, so audience is the only thing that varies.
     Personal ones live under their own key — never in the shared blob. */
  if (path === '/api/sheets/events' && req.method === 'POST') {
    const body = await req.json();
    const id = body.sheet || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !(await myAccess(env, acct, id))) return bad('אין לך הרשאה', 403);
    const admin = isAdmin(sheet, mem, s.account);
    const personal = !!body.personal;
    if (!personal && !admin) return bad('רק מנהל יכול לפרסם לוז', 403);

    const key = personal ? 'pev:' + s.account + ':' + id : 'events:' + id;
    let list = (await getJSON(env, key)) || [];

    if (body.remove) {
      list = list.filter(x => x.id !== body.remove);
      list.length ? await putJSON(env, key, list, { expirationTtl: 60 * 86400 }) : await env.SH.delete(key);
      return json({ ok: true, events: list });
    }
    if (body.clearAll) { await env.SH.delete(key); return json({ ok: true, events: [] }); }

    const rosterNow = await getJSON(env, 'roster:' + id);
    let to = { kind: 'all' };
    if (personal) to = { kind: 'self' };
    else if (body.to && body.to.kind === 'people') {
      let names = (body.to.names || []).map(x => String(x || '').trim()).filter(Boolean);
      if (body.to.group) {
        const groups = (await getJSON(env, 'groups:' + id)) || [];
        const g = groups.find(x => P.normKey(x.name) === P.normKey(body.to.group));
        if (g) names = g.people.slice();
      }
      names = Array.from(new Set(names)).slice(0, 400);
      if (!names.length) return bad('לא נבחרו נמענים');
      to = { kind: 'people', names, group: body.to.group || '' };
    }

    const from = (mem && (mem.name || mem.email)) || '';
    const incoming = (Array.isArray(body.items) ? body.items : []).slice(0, 40);
    const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const made = [];
    for (const it of incoming) {
      const at = +it.at || 0;
      if (!at || Math.abs(at - Date.now()) > 120 * DAY) continue;
      const text = String(it.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text) continue;
      // mins 0 is a moment: it stops being shown the minute it passes
      made.push({
        id: rid().slice(0, 10), at, mins: Math.max(0, Math.min(+it.mins || 0, 720)),
        text, title, to, by: s.account, from, createdAt: Date.now(),
      });
    }
    if (!made.length) return bad('אין פריטים תקינים');

    // keep the list small and forward-looking; yesterday's לוז is noise
    list = list.filter(x => x.at > Date.now() - 2 * DAY).concat(made)
      .sort((a, b) => a.at - b.at).slice(-200);
    await putJSON(env, key, list, { expirationTtl: 60 * 86400 });

    let sent = 0;
    if (!personal && body.notify) {
      const first = made[0];
      const members = await env.SH.list({ prefix: 'member:' + id + ':' });
      for (const k of members.keys) {
        const account = k.name.split(':').pop();
        if (account === s.account) continue;
        if (to.kind === 'people') {
          const a = await getJSON(env, 'acct:' + account);
          const person = a && a.sheets && a.sheets[id] && resolvePerson(rosterNow, a.sheets[id].person);
          if (!N.inAudience(to, person)) continue;
        }
        const label = made.length > 1 ? (title || 'לוז') + ' · ' + made.length + ' סעיפים' : first.text;
        if (await pushAccount(env, account, { kind: 'msg', text: label, from, sheet: id, when: first.at, mins: first.mins })) sent++;
      }
    }
    return json({ ok: true, added: made.length, sent, events: list });
  }

  /* Named squads, kept beside the שבצ״ק. Everyone can read them — knowing who
     is in פיקוד is not a secret and the list is useful on screen — but only an
     admin writes them. */
  if (path === '/api/sheets/groups') {
    const id = sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    if (!sheet) return bad('sheet not found', 404);
    if (!(await myAccess(env, acct, id))) return bad('אין לך הרשאה', 403);
    const mem = await getJSON(env, memberKey(id, s.account));
    const admin = isAdmin(sheet, mem, s.account);
    const roster = await getJSON(env, 'roster:' + id);
    if (req.method !== 'POST') {
      return json({ groups: (await getJSON(env, 'groups:' + id)) || [], admin });
    }
    if (!admin) return bad('רק מנהל יכול לערוך קבוצות', 403);
    const body = await req.json();
    const clean = N.sanitiseGroups(body.groups || [], (roster && roster.names) || []);
    if (clean.length) await putJSON(env, 'groups:' + id, clean);
    else await env.SH.delete('groups:' + id);
    return json({ ok: true, groups: clean });
  }

  if (path === '/api/sheets/contacts') {
    const id = sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    if (!sheet) return bad('sheet not found', 404);
    if (!(await myAccess(env, acct, id))) return bad('אין לך הרשאה', 403);
    const mem = await getJSON(env, memberKey(id, s.account));
    const admin = isAdmin(sheet, mem, s.account);
    if (req.method !== 'POST') {
      return json({ contacts: (await getJSON(env, 'contacts:' + id)) || [], admin });
    }
    if (!admin) return bad('רק מנהל יכול לערוך את אנשי הקשר', 403);
    const body = await req.json();
    const clean = N.sanitiseContacts(body.contacts || []);
    if (clean.length) await putJSON(env, 'contacts:' + id, clean);
    else await env.SH.delete('contacts:' + id);
    return json({ ok: true, contacts: clean });
  }

  /* An admin saying something to everyone at once. The unit's actual failure
     mode is a WhatsApp message nobody read — "בדיקת נשק ב-08:50" — and the fix
     is not to read WhatsApp, it is to put the message somewhere that buzzes.
     Also kept on the שבצ״ק so whoever had notifications off still sees it. */
  if (path === '/api/sheets/broadcast' && req.method === 'POST') {
    const body = await req.json();
    const id = body.sheet || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('רק מנהל יכול לשלוח הודעה', 403);

    const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (body.clear) { await env.SH.delete('bcast:' + id); return json({ ok: true, cleared: true }); }
    if (text.length < 2) return bad('הודעה ריקה');

    /* A message with an hour on it is not a message, it's an appointment —
       so it lands in everybody's day. Except the people who are on a watch at
       that hour: they physically cannot be there, and putting it in their list
       would be telling them to be in two places. */
    let at = 0, mins = 0;
    if (body.at) {
      at = +body.at || 0;
      if (!at || Math.abs(at - Date.now()) > 60 * DAY) return bad('הזמן לא הגיוני');
      mins = Math.max(0, Math.min(+body.mins || 0, 720));
    }

    // one a minute is plenty; a stuck finger must not become 30 pushes
    const last = await getJSON(env, 'bcast:' + id);
    if (last && Date.now() - last.at < 45000 && !body.force) {
      return json({ error: 'שלחת הודעה לפני רגע. חכה דקה.', tooSoon: true }, 429);
    }

    const from = (mem && (mem.name || mem.email)) || '';
    const rosterNow = await getJSON(env, 'roster:' + id);
    let to = { kind: 'all' };
    if (body.to && body.to.kind === 'people') {
      let names = (body.to.names || []).map(x => String(x || '').trim()).filter(Boolean);
      if (body.to.group) {                       // a squad, resolved at send time
        const groups = (await getJSON(env, 'groups:' + id)) || [];
        const g = groups.find(x => P.normKey(x.name) === P.normKey(body.to.group));
        if (g) names = g.people.slice();
      }
      names = Array.from(new Set(names)).slice(0, 400);
      if (!names.length) return bad('לא נבחרו נמענים');
      to = { kind: 'people', names, group: body.to.group || '' };
    }
    const rec = { text, at: Date.now(), by: s.account, from, to, id: rid().slice(0, 10) };
    if (at) {
      rec.when = at; rec.mins = mins;
      const evs = ((await getJSON(env, 'events:' + id)) || []).filter(x => x.at > Date.now() - 2 * DAY);
      evs.push({ id: rec.id, at, mins, text, title: '', to, by: s.account, from, createdAt: Date.now() });
      await putJSON(env, 'events:' + id, evs.sort((a, b) => a.at - b.at).slice(-200), { expirationTtl: 60 * 86400 });
    }
    await putJSON(env, 'bcast:' + id, rec, { expirationTtl: 14 * 86400 });

    const list = await env.SH.list({ prefix: 'member:' + id + ':' });
    let sent = 0, targeted = 0;
    for (const k of list.keys) {
      const account = k.name.split(':').pop();
      if (account === s.account) continue;                 // don't buzz the sender
      if (to.kind === 'people') {
        // the audience is roster names; a member is whoever they picked as theirs
        const a = await getJSON(env, 'acct:' + account);
        const person = a && a.sheets && a.sheets[id] && resolvePerson(rosterNow, a.sheets[id].person);
        if (!N.inAudience(to, person)) continue;
      }
      targeted++;
      const ok = await pushAccount(env, account, { kind: 'msg', text, from, sheet: id, when: at || 0 });
      if (ok) sent++;
    }
    return json({ ok: true, sent, members: targeted, bcast: rec });
  }

  if (path === '/api/sheets/rules') {
    const id = sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet) return bad('sheet not found', 404);
    const rec = (await getJSON(env, 'rules:' + id)) || { rev: 0, posts: {} };
    if (req.method !== 'POST') {
      const r = await getJSON(env, 'roster:' + id);
      return json({
        rules: rec.posts || {}, posts: (r && r.posts) || [],
        hidden: rec.hidden === 'keep' ? 'keep' : 'skip',
        hiddenCount: hiddenCountOf(r),
        admin: isAdmin(sheet, mem, s.account),
      });
    }
    if (!isAdmin(sheet, mem, s.account)) return bad('רק מי שהוסיף את הגיליון יכול לשנות', 403);
    const body = await req.json();
    const clean = {};
    for (const [k, v] of Object.entries(body.rules || {})) {
      if (!v || v.mode !== 'daily') continue;
      if (!/^\d{1,2}:\d{2}$/.test(v.start || '') || !/^\d{1,2}:\d{2}$/.test(v.end || '')) continue;
      clean[P.normKey(k)] = { mode: 'daily', start: v.start, end: v.end, label: k, carry: !!v.carry };
    }
    // the post editor posts rules alone; don't let it silently flip this
    const hidden = body.hidden === undefined ? (rec.hidden || 'skip')
      : (body.hidden === 'keep' ? 'keep' : 'skip');
    const posts = body.rules === undefined ? (rec.posts || {}) : clean;
    await putJSON(env, 'rules:' + id, { rev: (rec.rev || 0) + 1, posts, hidden });
    const out = await pollSheet(env, ctx, id, true);      // re-parse immediately, silently
    return json({ ok: true, rules: posts, hidden, hiddenCount: hiddenCountOf(await getJSON(env, 'roster:' + id)), poll: out });
  }

  if (path === '/api/sheets/requests') {
    const id = sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);
    const list = await env.SH.list({ prefix: 'req:' + id + ':' });
    const out = [];
    for (const k of list.keys) { const r = await getJSON(env, k.name); if (r) out.push(r); }
    out.sort((a, b) => a.at - b.at);
    return json({ requests: out });
  }

  if ((path === '/api/sheets/approve' || path === '/api/sheets/deny') && req.method === 'POST') {
    const { sheet: sid, account } = await req.json();
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);
    const rq = await getJSON(env, 'req:' + id + ':' + account);
    await env.SH.delete('req:' + id + ':' + account);
    if (path === '/api/sheets/deny' || !rq) return json({ ok: true });

    await putJSON(env, memberKey(id, account), {
      account, email: rq.email, name: rq.name, joinedAt: Date.now(), via: 'request',
      approvedBy: s.account, role: 'member',
    });
    const a = await getJSON(env, 'acct:' + account);
    if (a) {
      a.sheets = a.sheets || {};
      a.sheets[id] = a.sheets[id] || { person: null };
      a.sheets[id].checkedAt = Date.now();
      a.active = id;
      await putJSON(env, 'acct:' + account, a);
    }
    ctx.waitUntil(pushAccount(env, account));
    return json({ ok: true });
  }

  if (path === '/api/sheets/members') {
    const id = sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);
    const list = await env.SH.list({ prefix: 'member:' + id + ':' });
    const out = [];
    for (const k of list.keys) {
      const m = await getJSON(env, k.name);
      if (!m) continue;
      const a = await getJSON(env, 'acct:' + m.account);
      out.push({ account: m.account, email: m.email, name: m.name, via: m.via, role: m.role, joinedAt: m.joinedAt,
                 person: (a && a.sheets && a.sheets[id] && a.sheets[id].person) || null });
    }
    out.sort((x, y) => (x.joinedAt || 0) - (y.joinedAt || 0));
    return json({ members: out, admin: true, owner: sheet.addedBy, me: s.account,
                  openUntil: sheet.openUntil || 0, link: await liveLink(env, sheet) });
  }

  /* The person who first connected a שבצ"ק owns it, and can hand out admin —
     so another unit runs itself without going through whoever deployed this. */
  /* Open enrolment: a bounded window where anyone who pastes the sheet link
     joins without approval. Always expires on its own — there is no "leave it
     on forever" option, because that is what it would become. */
  if (path === '/api/sheets/open' && req.method === 'POST') {
    const { sheet: sid, minutes } = await req.json();
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);

    const mins = Math.max(0, Math.min(+minutes || 0, 1440));
    sheet.openUntil = mins ? Date.now() + mins * 60000 : 0;
    sheet.openedBy = mins ? s.account : sheet.openedBy;
    await putJSON(env, 'sheet:' + id, sheet);

    let approved = 0;
    if (mins) {                                    // turning it on means "let them in"
      const list = await env.SH.list({ prefix: 'req:' + id + ':' });
      for (const k of list.keys) {
        const rq = await getJSON(env, k.name);
        await env.SH.delete(k.name);
        if (!rq) continue;
        await putJSON(env, memberKey(id, rq.account), {
          account: rq.account, email: rq.email, name: rq.name,
          joinedAt: Date.now(), via: 'open', role: 'member',
        });
        const a = await getJSON(env, 'acct:' + rq.account);
        if (a) {
          a.sheets = a.sheets || {};
          a.sheets[id] = a.sheets[id] || { person: null };
          a.sheets[id].checkedAt = Date.now();
          await putJSON(env, 'acct:' + rq.account, a);
        }
        ctx.waitUntil(pushAccount(env, rq.account));
        approved++;
      }
    }
    return json({ ok: true, openUntil: sheet.openUntil, approved });
  }

  if (path === '/api/sheets/role' && req.method === 'POST') {
    const { sheet: sid, account, role } = await req.json();
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const myMem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, myMem, s.account)) return bad('אין לך הרשאה', 403);
    if (role !== 'admin' && role !== 'member') return bad('bad role');
    if (account === sheet.addedBy) return bad('אי אפשר לשנות את הבעלים', 400);
    const target = await getJSON(env, memberKey(id, account));
    if (!target) return bad('לא נמצא', 404);
    // an admin who isn't the owner may promote, but may not demote another admin
    if (role === 'member' && target.role === 'admin' && s.account !== sheet.addedBy) {
      return bad('רק הבעלים יכול להסיר מנהל', 403);
    }
    target.role = role;
    await putJSON(env, memberKey(id, account), target);
    return json({ ok: true, role });
  }

  if (path === '/api/sheets/owner' && req.method === 'POST') {
    const { sheet: sid, account } = await req.json();
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    if (!sheet || sheet.addedBy !== s.account) return bad('רק הבעלים יכול להעביר בעלות', 403);
    const target = await getJSON(env, memberKey(id, account));
    if (!target) return bad('לא נמצא', 404);
    target.role = 'admin';
    await putJSON(env, memberKey(id, account), target);
    // the previous owner stays on as an admin rather than being locked out
    const mine = (await getJSON(env, memberKey(id, s.account))) || { account: s.account, joinedAt: Date.now(), via: 'sheets' };
    mine.role = 'admin';
    await putJSON(env, memberKey(id, s.account), mine);
    sheet.addedBy = account;
    await putJSON(env, 'sheet:' + id, sheet);
    ctx.waitUntil(pushAccount(env, account));
    return json({ ok: true });
  }

  if (path === '/api/sheets/revoke' && req.method === 'POST') {
    const { sheet: sid, account } = await req.json();
    const id = sid || sheetParam;
    const sheet = await getJSON(env, 'sheet:' + id);
    const mem = await getJSON(env, memberKey(id, s.account));
    if (!sheet || !isAdmin(sheet, mem, s.account)) return bad('אין לך הרשאה', 403);
    if (account === s.account) return bad('אי אפשר להסיר את עצמך', 400);
    if (account === sheet.addedBy) return bad('אי אפשר להסיר את הבעלים', 400);
    await env.SH.delete(memberKey(id, account));
    const a = await getJSON(env, 'acct:' + account);
    if (a && a.sheets) { delete a.sheets[id]; await putJSON(env, 'acct:' + account, a); }
    await env.SH.delete('sub:' + account);
    return json({ ok: true });
  }

  if (path === '/api/account/transfer') {
    const code = rid().slice(0, 10).toUpperCase();
    await env.SH.put('xfer:' + code, s.account, { expirationTtl: 900 });
    return json({ code, expiresIn: 900 });
  }
  if (path === '/api/account/adopt' && req.method === 'POST') {
    const { code } = await req.json();
    const target = await env.SH.get('xfer:' + String(code || '').trim().toUpperCase());
    if (!target) return bad('הקוד לא תקף', 404);
    const sid = rid();
    await putJSON(env, 'sid:' + sid, { account: target });
    return json({ sid, account: target }, 200, { 'set-cookie': SESSION_COOKIE(sid) });
  }

  if (path === '/api/logout' && req.method === 'POST') {
    await env.SH.delete('sid:' + s.sid);
    return json({ ok: true }, 200, { 'set-cookie': CLEAR_COOKIE });
  }

  if (path === '/api/refresh' && req.method === 'POST') {
    if (!sheetParam) return bad('no sheet');
    const sh = await getJSON(env, 'sheet:' + sheetParam);
    if (sh && sh.kind === 'native') return json({ unchanged: true, native: true });
    // "בדוק עכשיו" means read it again, not "tell me the hash is the same" —
    // it is the escape hatch when a sheet is stuck for any reason at all
    return json(await pollSheet(env, ctx, sheetParam, true));
  }

  if (path === '/api/health') {
    const list = await env.SH.list({ prefix: 'sheet:' });
    const hb = (await getJSON(env, 'poll:hb')) || {};
    const batch = Math.max(1, Math.min(+(env.POLL_BATCH || 20), Math.max(1, list.keys.length)));
    const cycleMin = Math.ceil(list.keys.length / batch) * 5;
    return json({
      sheets: list.keys.length, batch, cycleMinutes: cycleMin,
      lastTick: hb.at || 0, lastChanged: hb.changed, lastErrors: hb.errors,
      estKvWritesPerDay: '≈ 2 per sheet change (unchanged polls write nothing)',
    });
  }

  if (path === '/api/diag') {                     // why did a tab come back empty?
    if (!sheetParam) return bad('no sheet');
    const r = await getJSON(env, 'roster:' + sheetParam);
    const sh = await getJSON(env, 'sheet:' + sheetParam);
    return json({ warnings: (r && r.warnings) || [], tabs: (r && r.tabs) || [], scheduleTabs: (r && r.scheduleTabs) || [], lastPoll: sh && sh.lastPoll, lastError: sh && sh.lastError });
  }

  return bad('not found', 404);
}
const sheetList = acct => Object.keys(acct.sheets || {});

/* Exported so test/widget.js can check the sentences the phone will show.
   Cloudflare only ever looks at the default export. */
export { widgetView };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, ctx, url); }
      catch (e) { return bad(String((e && e.message) || e), 500); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollAll(env, ctx).then(r => console.log('poll', JSON.stringify(r))).catch(e => console.log('poll failed', e.message)));
    ctx.waitUntil(remindAll(env, ctx).then(r => console.log('remind', JSON.stringify(r))).catch(e => console.log('remind failed', e.message)));
  },
};
