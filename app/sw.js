/* שבצ"ק service worker — offline shell + change notifications */
const CACHE = 'sh-__BUILD__';                 // build-stamped: every deploy busts it
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* the session token, stashed where the SW can reach it */
const SID_REQ = new Request('/__sid');
async function putSid(sid) { const c = await caches.open(CACHE); await c.put(SID_REQ, new Response(sid)); }
async function getSid() { const c = await caches.open(CACHE); const r = await c.match(SID_REQ); return r ? r.text() : null; }
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'sid' && e.data.sid) e.waitUntil(putSid(e.data.sid));
  if (e.data.type === 'badge') e.waitUntil(putFlag('badgeOff', e.data.off ? '1' : ''));
});
/* small key/value in the same cache, for settings the SW needs while asleep */
const FLAG_REQ = k => new Request('/__flag/' + k);
async function putFlag(k, v) { const c = await caches.open(CACHE); await c.put(FLAG_REQ(k), new Response(v)); }
async function getFlag(k) { const c = await caches.open(CACHE); const r = await c.match(FLAG_REQ(k)); return r ? r.text() : ''; }

/* iOS gives a home screen web app no widget, so the number on the icon is the
   nearest thing there is: how many watches you have in the next 24 hours. The
   push that wakes us is the only chance to refresh it while the app is closed,
   so we take it — right after the notification, since a badge on its own does
   not satisfy the "user visible" rule and would eventually cost us the
   subscription. */
async function refreshBadge(auth) {
  try {
    if (!('setAppBadge' in self.navigator)) return;
    if (await getFlag('badgeOff')) { await self.navigator.clearAppBadge(); return; }
    const b = await fetch('/api/badge', { headers: auth, credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    if (!b) return;
    if (b.n > 0) await self.navigator.setAppBadge(b.n); else await self.navigator.clearAppBadge();
  } catch (e) { }
}

/* The page itself is network-first so a deploy is picked up on the next load;
   the cached copy is only the offline fallback. Static assets stay cache-first.
   Cache-first on the HTML is how a stale build survives a deploy forever. */
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  const isPage = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  if (isPage) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('/index.html', copy)).catch(() => { });
        return res;
      }).catch(() => caches.match('/index.html').then(hit => hit || caches.match('/')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => { });
      return res;
    }))
  );
});

const pad = n => String(n).padStart(2, '0');
const TZ = 'Asia/Jerusalem';
const PF = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function zp(ts) {
  const o = {};
  for (const p of PF.formatToParts(new Date(ts))) if (p.type !== 'literal') o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute,
           wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
function fmt(x) {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const a = zp(x.s), b = zp(Date.now());
  const diff = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 864e5);
  const day = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : 'יום ' + days[a.wd] + ' ' + a.d + '.' + a.mo;
  return day + ' ' + pad(a.h) + ':' + pad(a.mi) + (x.p ? ' · ' + x.p : '');
}

const hhmm = ts => { const p = zp(ts); return pad(p.h) + ':' + pad(p.mi); };

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'השבצ״ק עודכן', body = 'יש שינוי בשיבוצים שלך';
    let tag = 'sh-change', vibrate = [80, 40, 80];
    let auth = {};
    try {
      const sid = await getSid();
      auth = sid ? { authorization: 'Bearer ' + sid } : {};

      const n = await fetch('/api/notify', { headers: auth, credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null).catch(() => null);

      if (n && n.kind === 'event') {
        tag = 'sh-event';
        vibrate = [120, 60, 120];
        title = n.mins <= 1 ? 'מתחיל עכשיו' : 'בעוד ' + n.mins + ' דקות';
        body = (n.text || '') + '\n' + hhmm(n.start);
      } else if (n && n.kind === 'msg') {
        tag = 'sh-msg';
        vibrate = [60, 40, 60, 40, 60];
        title = n.from ? 'הודעה מ' + n.from : 'הודעה מהמפקד';
        body = (n.text || '') + (n.when ? '\n' + hhmm(n.when) : '');
      } else if (n && n.kind === 'reminder') {
        tag = 'sh-reminder';
        vibrate = [120, 60, 120, 60, 200];
        title = n.mins <= 1 ? 'השמירה שלך מתחילה עכשיו' : 'שמירה בעוד ' + n.mins + ' דקות';
        body = hhmm(n.start) + '–' + hhmm(n.end) + (n.post ? ' · ' + n.post : '') +
          (n.withMe && n.withMe.length ? '\nאיתך: ' + n.withMe.join(', ') : '');
      } else {
        const c = await fetch('/api/changes', { headers: auth, credentials: 'same-origin' })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        if (c && c.mine) {
          const lines = [];
          c.mine.added.slice(0, 3).forEach(x => lines.push('נוספה: ' + fmt(x)));
          c.mine.removed.slice(0, 3).forEach(x => lines.push('בוטלה: ' + fmt(x)));
          if (lines.length) {
            body = lines.join('\n');
            title = c.mine.added.length && !c.mine.removed.length ? 'נוספה לך שמירה'
              : !c.mine.added.length && c.mine.removed.length ? 'בוטלה לך שמירה' : 'השמירות שלך השתנו';
          }
        }
      }
    } catch (err) { }
    await self.registration.showNotification(title, {
      body, dir: 'rtl', lang: 'he', tag, renotify: true,
      icon: '/icon-192.png', badge: '/icon-192.png', vibrate,
      requireInteraction: tag === 'sh-reminder',
    });
    await refreshBadge(auth);
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes(location.origin)) return c.focus();
    return clients.openWindow('/');
  }));
});
