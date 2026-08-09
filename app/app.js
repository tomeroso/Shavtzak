/* ============================================================
   שבצ"ק — client
   ============================================================ */
(function () {
  'use strict';
  const M = globalThis.SHMatch;
  const $ = s => document.querySelector(s);
  const el = (t, c, h) => { const x = document.createElement(t); if (c) x.className = c; if (h != null) x.innerHTML = h; return x; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('sh.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sh.' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem('sh.' + k); } catch (e) { } },
  };

  const S = {
    cfg: null, sid: LS.get('sid', null), account: LS.get('account', null),
    sheets: [], sheet: LS.get('sheet', null),
    roster: null, me: null, viewing: null,
    nicknames: [], loading: false, changes: null, lastSeen: 0,
  };
  const sq = p => p + (p.indexOf('?') < 0 ? '?' : '&') + 'sheet=' + encodeURIComponent(S.sheet || '');

  /* ---------- api ---------- */
  async function api(path, body, method) {
    let r;
    try {
      r = await fetch(path, {
        method: method || (body ? 'POST' : 'GET'),
        credentials: 'same-origin',                 // carries the session cookie too
        headers: Object.assign({ 'content-type': 'application/json' }, S.sid ? { authorization: 'Bearer ' + S.sid } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('אין חיבור לרשת');       // offline is NOT logged out
      err.offline = true;
      throw err;
    }
    if (r.status === 401) { S.sid = null; LS.del('sid'); const e = new Error('צריך להתחבר מחדש'); e.auth = true; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('שגיאה ' + r.status)); e.needPicker = !!j.needPicker; e.needConfirm = !!j.needConfirm; throw e; }
    return j;
  }

  /* ---------- format ----------
     Everything is rendered in the roster's timezone, not the device's, so a
     phone with the wrong clock zone still shows the times the sheet says. */
  const pad = n => String(n).padStart(2, '0');
  const TZ = () => (S.roster && S.roster.tz) || 'Asia/Jerusalem';
  let _pf = null, _pfTz = '';
  function zparts(d) {
    const tz = TZ();
    if (_pfTz !== tz) {
      _pfTz = tz;
      _pf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    }
    const o = {};
    for (const p of _pf.formatToParts(d instanceof Date ? d : new Date(d))) if (p.type !== 'literal') o[p.type] = p.value;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday);
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd };
  }
  const hm = d => { const p = zparts(d); return pad(p.h) + ':' + pad(p.mi); };
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function dayLabel(d, now) {
    const a = zparts(d), b = zparts(now);
    const n = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 864e5);
    if (n === 0) return 'היום'; if (n === 1) return 'מחר'; if (n === 2) return 'מחרתיים';
    if (n === -1) return 'אתמול';
    return 'יום ' + DAYS[a.wd] + ' ' + a.d + '.' + a.mo;
  }
  /* "נסגר בעוד …" — rounded up, because a link that says 0 is still open. */
  function fmtLeft(ms) {
    const mn = Math.ceil(ms / 60000);
    if (mn < 60) return 'נסגר בעוד ' + mn + ' דק׳';
    const h = Math.ceil(mn / 60);
    if (h < 48) return 'נסגר בעוד ' + h + ' שעות';
    return 'נסגר בעוד ' + Math.ceil(h / 24) + ' ימים';
  }
  function dur(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), dd = Math.floor(h / 24);
    if (dd >= 2) return { v: String(dd), u: 'ימים' };
    if (h >= 1) return { v: h + ':' + pad(m % 60), u: 'שעות' };
    if (m >= 1) return { v: m + ':' + pad(s % 60), u: 'דקות' };
    return { v: String(s), u: 'שניות' };
  }
  const durHTML = ms => { const d = dur(ms); return `<bdi>${d.v}</bdi><span class="unit">${d.u}</span>`; };
  function durShort(ms) {
    if (ms < 0) return 'עכשיו';
    const m = Math.round(ms / 60000), h = Math.floor(m / 60);
    if (h >= 20) return '';
    if (h >= 1) return 'בעוד ' + h + ' שע׳' + (m % 60 ? ' ' + (m % 60) + ' דק׳' : '');
    return m >= 1 ? 'בעוד ' + m + ' דק׳' : 'עוד רגע';
  }
  const ICON = {
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z"/></svg>',
    people: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M17 20a6 6 0 0 0-1.6-4.1"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  };

  /* ---------- roster helpers ---------- */
  const nk = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[׳״'"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const shifts = () => (S.roster && S.roster.shifts) || [];

  /* Someone can pick a name that isn't in the שבצ"ק yet — a new arrival, someone
     on leave, or a spelling nobody has typed into the sheet the same way. Match
     exactly first; if that finds nothing, fall back to a confident fuzzy match so
     the app starts working the moment they do appear, without them having to
     notice and re-pick. */
  function resolveName(name) {
    if (!name || !S.roster) return { name, exact: true };
    const t = nk(name);
    if (shifts().some(s2 => nk(s2.n) === t)) return { name, exact: true };
    const hit = M.rankNames(name, S.roster.names || [], 1, S.roster.aliases || {})[0];
    if (hit && hit.score >= 0.93 && nk(hit.name) !== t) return { name: hit.name, exact: false, typed: name };
    return { name, exact: true, missing: true };
  }
  function mine(name) {
    const r = resolveName(name);
    const t = nk(r.name);
    return shifts().filter(s2 => nk(s2.n) === t);
  }
  function statusFor(name, now) {
    const ms = mine(name);
    const active = ms.filter(s => s.s <= +now && +now < s.e);
    const current = active[0] || null;
    const upcoming = ms.filter(s => s.s > +now);
    const next = upcoming[0] || null;
    const withMe = current ? [...new Set(shifts().filter(s => s.s === current.s && s.p === current.p && nk(s.n) !== nk(name)).map(s => s.n))] : [];
    const relief = current ? [...new Set(shifts().filter(s => s.s === current.e && s.p === current.p).map(s => s.n))] : [];
    return { current, active, next, upcoming, withMe, relief, total: ms.length };
  }
  const D = t => new Date(t);

  /* ---------- the number on the app icon ----------
     iOS won't give a web app a home screen widget, so this is the closest
     thing: the count of watches you still have in the next 24 hours, sitting
     on the icon. It needs the app installed and notifications allowed, and it
     is refreshed here, in the service worker on every push, and on every open.
     Anything we can't do quietly fails quietly — a badge is never worth an
     error on screen. */
  function badgeCount(now) {
    const who = S.me;
    if (!who || !S.roster) return 0;
    const t = +(now || new Date());
    const ms = mine(who);
    return ms.filter(s => s.e > t && s.s < t + 864e5).length;
  }
  async function setBadge() {
    try {
      if (!('setAppBadge' in navigator)) return;
      if (LS.get('badgeOff', 0)) { await navigator.clearAppBadge(); return; }
      const n = badgeCount(new Date());
      if (n > 0) await navigator.setAppBadge(n); else await navigator.clearAppBadge();
    } catch (e) { }
  }

  /* ---------- toast ---------- */
  let tt;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3500);
  }

  /* ============================ screens ============================ */
  function screenSignIn(err) {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo">שבצ״ק</div>
      <p class="sub">${S.cfg && S.cfg.sheetTitle ? esc(S.cfg.sheetTitle) : 'מתי השמירה הבאה שלך'}</p>
      ${err ? `<div class="err">${esc(String(err && err.message || err))}
        ${err && err.stack ? `<details><summary>פרטים</summary><pre dir="ltr">${esc(err.stack)}</pre></details>` : ''}</div>` : ''}
      <button id="gsi" class="btn primary">התחברות עם Google</button>
      <p class="fine">מתחברים פעם אחת וזהו. לא נבקש ממך שוב.<br>הגיליון נשאר פרטי; רק מי שכבר יש לו גישה יכול לראות משהו.</p>
      <details class="help"><summary>יש לי קוד העברה ממכשיר אחר</summary>
        <input id="xfer" class="inp" dir="ltr" placeholder="XXXXXXXXXX" autocapitalize="characters">
        <button id="adopt" class="btn ghost">כניסה עם קוד</button>
      </details>`;
    v.appendChild(c);
    $('#gsi').onclick = signIn;
    $('#adopt').onclick = async () => {
      try {
        const r = await api('/api/account/adopt', { code: $('#xfer').value.trim() });
        S.sid = r.sid; S.account = r.account; LS.set('sid', r.sid); LS.set('account', r.account);
        await loadSheets(); if (S.sheet) await loadRoster(); route();
      } catch (e) { toast(e.message); }
    };
  }

  const BASIC = 'openid email profile';
  // drive.file instead of spreadsheets.readonly: non-sensitive, so no 100-account
  // cap and no unverified-app screen for anyone. The price is that the sheet has
  // to be chosen through Google's own Picker rather than pasted as a link.
  const SHEETS = BASIC + ' https://www.googleapis.com/auth/drive.file';

  // Basic profile is a non-sensitive scope: no 100-user cap and no warning screen.
  // Only the person who ADDS a שבצ"ק needs the Sheets scope, and gets asked for it
  // separately, at the moment they add one.
  function googleAuth(scope, onDone, onErr) {
    if (!window.google || !google.accounts) { (onErr || toast)('Google לא נטען. בדוק שיש חיבור'); return; }
    google.accounts.oauth2.initCodeClient({
      client_id: S.cfg.clientId, scope, ux_mode: 'popup',
      access_type: 'offline', prompt: 'consent',
      callback: async resp => {
        if (!resp.code) { (onErr || toast)('ההתחברות בוטלה'); return; }
        try {
          const r = await api('/api/auth', { code: resp.code, redirectUri: 'postmessage' });
          S.sid = r.sid; S.account = r.account;
          if (r.pickerToken) S.pickerToken = r.pickerToken;
          LS.set('sid', r.sid); LS.set('account', r.account);
          await onDone(r);
        } catch (e) { console.error(e); (onErr || toast)(e); }
      },
    }).requestCode();
  }
  function signIn() {
    googleAuth(BASIC, async () => {
      await loadSheets();
      if (pendingInvite) { await redeemInvite(pendingInvite); return; }
      if (S.sheet) await loadRoster();
      route();
    }, screenSignIn);
  }
  function grantSheetsScope(then) {
    googleAuth(SHEETS, async r => { if (r && r.pickerToken) S.pickerToken = r.pickerToken; await then(); }, toast);
  }

  /* ---------- Google Picker ---------- */
  function loadPicker() {
    return new Promise((res, rej) => {
      if (window.google && window.google.picker) return res();
      const sc = document.createElement('script');
      sc.src = 'https://apis.google.com/js/api.js';
      sc.onload = () => gapi.load('picker', { callback: res, onerror: rej });
      sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  async function pickSheet() {
    if (!S.cfg.pickerApiKey || !S.cfg.appId) {
      toast('חסרה הגדרת Picker בשרת'); return;
    }
    if (!S.pickerToken) { grantSheetsScope(() => pickSheet()); return; }
    try { await loadPicker(); } catch (e) { toast('לא הצלחתי לטעון את בורר הקבצים'); return; }

    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true).setSelectFolderEnabled(false).setEnableDrives(true);
    const shared = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setOwnedByMe(false).setIncludeFolders(true).setSelectFolderEnabled(false);
    new google.picker.PickerBuilder()
      .setAppId(S.cfg.appId)                     // without this the pick grants nothing
      .setDeveloperKey(S.cfg.pickerApiKey)
      .setOAuthToken(S.pickerToken)
      .addView(view).addView(shared)
      .setOrigin(location.protocol + '//' + location.host)
      .setTitle('בחר את השבצ״ק')
      .setCallback(async data => {
        if (data.action !== google.picker.Action.PICKED) return;
        const doc = data.docs && data.docs[0];
        if (!doc) return;
        try { await afterAdd(await api('/api/sheets/add', { id: doc.id })); }
        catch (e) { screenAddSheet(e.message); }
      })
      .build().setVisible(true);
  }

  function screenPick(forOther) {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    const names = (S.roster && S.roster.names) || [];
    const sample = ((names[0] || '').split(' ')[0]) || '';
    c.innerHTML = `
      <div class="logo sm">${forOther ? 'מי אתה מחפש?' : 'מה השם שלך?'}</div>
      <p class="sub">שם פרטי, שם משפחה, כינוי או באנגלית. הכל עובד.</p>
      <input id="q" class="inp big" placeholder="${esc(sample)}" autocomplete="off" enterkeyhint="go">
      <div id="res" class="results"></div>
      ${forOther ? '<button id="back" class="btn ghost">חזרה</button>' : ''}
      <div class="meta">${names.length} אנשים · ${(S.roster.shifts || []).length} שיבוצים</div>
      ${names.length ? '' : '<div class="err">הגיליון נקרא אבל לא נמצאו בו שמות. לחץ על גלגל השיניים ← אבחון.</div>'}`;
    v.appendChild(c);
    const q = $('#q'), res = $('#res');
    function choose(chosen) {
      if (forOther) { S.viewing = chosen; route(); return; }
      S.me = chosen; S.viewing = null;
      if (S.roster) {                          // keep the offline copy in step
        S.roster.me = chosen;
        try { LS.set('roster:' + S.sheet, S.roster); } catch (e) { }
      }
      setBadge();                              // the count belongs to the name
      (async () => {
        LS.set('me:' + S.sheet, chosen);
        try { await api('/api/me', { sheet: S.sheet, person: chosen }); } catch (e) { }
        applyNicknames();
        try { S.changes = await api(sq('/api/changes')); } catch (e) { console.warn('changes:', e.message); }
        route();
      })();
    }
    function draw() {
      const val = q.value.trim();
      res.innerHTML = '';
      const list = val.length >= 2 ? M.rankNames(val, names, 8, S.roster.aliases || {})
        : names.slice(0, 6).map(n => ({ name: n, score: 0 }));
      if (val.length >= 2 && !list.length) res.appendChild(el('div', 'none', 'לא נמצא שם דומה'));

      list.forEach(r => {
        const cnt = mine(r.name).length;
        const alias = (S.roster.aliases || {})[r.name];
        const loc = (S.roster.locations || {})[r.name];
        const b = el('button', 'res' + (r.score >= 0.97 ? ' exact' : ''));
        b.innerHTML = `<span class="rn">${esc(r.name)}${alias ? `<span class="alias">גם: ${esc(alias.filter(a => a !== r.name).join(', '))}</span>` : ''}</span>
          <span class="rc">${cnt ? cnt + ' שיבוצים' : 'אין שיבוצים'}${loc ? ' · ' + esc(loc) : ''}</span>`;
        b.onclick = () => choose(r.name);
        res.appendChild(b);
      });

      // A name that simply isn't in the sheet yet — new arrival, someone on
      // leave, or a spelling nobody has typed the same way. Let them commit it.
      if (val.length >= 2 && !list.some(r => nk(r.name) === nk(val))) {
        const b = el('button', 'res add');
        b.innerHTML = `<span class="rn">השתמש ב״${esc(val)}״<span class="alias">עדיין לא בשבצ״ק. יתחיל לעבוד ברגע שתשובץ</span></span><span class="rc">הוסף</span>`;
        b.onclick = () => choose(val);
        res.appendChild(b);
      }
    }
    q.oninput = draw;
    q.onkeydown = e => { if (e.key === 'Enter') { const b = res.querySelector('.res'); if (b) b.click(); } };
    draw(); setTimeout(() => q.focus(), 60);
    if (forOther) $('#back').onclick = () => { S.viewing = null; route(); };
  }

  /* Anything with an hour on it that isn't a watch: an announced event, a line
     of a לוז, or a note you keep for yourself. A shared one is dropped if you
     are standing a watch across it — you cannot be told to be in two places.
     Your own notes are never dropped: you put them there knowing. */
  /* An item is a moment, not a span. 11:00 אפסון means be there at eleven; at
     11:01 the next thing you need is 11:30, so it drops off rather than sitting
     there claiming to still be happening. */
  function eventRows(now) {
    const list = (S.roster && S.roster.events) || [];
    if (!list.length) return [];
    const myShifts = mine(S.viewing || S.me);
    const out = [];
    list.forEach(x => {
      const s = +x.at, e = s + (+x.mins || 0) * 60000;
      if (Math.max(s, e) <= +now) return;
      if (!x.mine && myShifts.some(y => y.s <= s && y.e > s)) return;
      out.push({ s, e, p: x.text, t: x.title || '', ev: 1, mine: x.mine ? 1 : 0, id: x.id });
    });
    return out;
  }
  const eventBusy = (x, now) => {
    const s = +x.at;
    return mine(S.viewing || S.me).some(y => y.s <= s && y.e > s);
  };

  /* Your own line in your own day. Nobody else sees it, and it is not dropped
     when you are on a watch — you wrote it, you know. */
  function addPersonal() {
    const now = new Date(), p0 = zparts(now);
    const wrap = el('div', 'pickwrap');
    const sheet = el('div', 'picksheet');
    sheet.innerHTML = `<div class="sect">להוסיף לעצמי</div>
      <div class="note">מופיע רק אצלך, ומזכיר לך לפניו כמו שמירה.</div>
      <input id="pvt" class="inp" placeholder="למשל: לקחת נשק מהנשקייה">
      <div class="grid2">
        <div><label class="lbl">תאריך</label><input id="pvd" class="inp" type="date" value="${p0.y}-${pad(p0.mo)}-${pad(p0.d)}"></div>
        <div><label class="lbl">שעה</label><input id="pvh" class="inp" type="time" value="${pad(p0.h)}:${pad(p0.mi)}"></div>
      </div>
      <button id="pvok" class="btn primary">הוסף</button>
      <button id="pvx" class="btn ghost">ביטול</button>`;
    wrap.appendChild(sheet); document.body.appendChild(wrap);
    const close = () => wrap.remove();
    $('#pvx').onclick = close;
    wrap.onclick = e => { if (e.target === wrap) close(); };
    $('#pvok').onclick = async () => {
      const text = $('#pvt').value.trim();
      if (text.length < 2) return toast('כתוב מה זה');
      const dp = ($('#pvd').value || '').split('-').map(Number), tp = ($('#pvh').value || '').split(':').map(Number);
      if (dp.length !== 3 || tp.length < 2) return toast('בחר תאריך ושעה');
      const at = NA().zonedEpoch(dp[0], dp[1], dp[2], tp[0], tp[1], TZ());
      try {
        await api(sq('/api/sheets/events'), { personal: true, items: [{ at, text }] });
        close(); await loadRoster(); render(); toast('נוסף');
      } catch (e) { toast(e.message); }
    };
    setTimeout(() => { try { $('#pvt').focus(); } catch (e) { } }, 30);
  }

  function screenMain() {
    const who = S.viewing || S.me;
    const v = $('#view'); v.innerHTML = '';
    const now = new Date();
    const st = statusFor(who, now);
    /* Declared up here because both the banner and the list below need them,
       and they must agree: the banner explains why the row is missing. */
    const bc = S.roster && S.roster.bcast;
    const mineAll = mine(who);
    const evRows = S.viewing ? [] : eventRows(now);
    const ev = bc && bc.when && !eventBusy({ at: bc.when, mins: bc.mins }, now);

    const top = el('div', 'topbar');
    top.innerHTML = `
      <button class="who" id="who"><span class="whoName">${esc(who)}</span>${(() => {
        const rn = resolveName(who);
        return rn.exact ? '' : `<span class="asname">→ ${esc(rn.name)}</span>`;
      })()}<span class="chev">▾</span></button>
      <div class="tools">
        <button class="icon" id="board" title="מי בשמירה עכשיו">${ICON.people}</button>
        <button class="icon" id="other" title="חפש מישהו אחר">${ICON.search}</button>
        <button class="icon" id="cfg" title="הגדרות">${ICON.gear}</button>
      </div>`;
    v.appendChild(top);

    if (S.sheets.length > 1) {
      const cur = S.sheets.find(x => x.id === S.sheet) || {};
      const bar = el('div', 'sheetbar');
      bar.innerHTML = S.sheets.map(x =>
        `<button class="stab${x.id === S.sheet ? ' on' : ''}" data-id="${esc(x.id)}">${esc(x.title || 'שבצ״ק')}${x.pending ? `<span class="badge">${x.pending}</span>` : ''}</button>`).join('');
      bar.querySelectorAll('.stab').forEach(b2 => b2.onclick = () => { if (b2.dataset.id !== S.sheet) switchSheet(b2.dataset.id); });
      v.appendChild(bar);
    }

    if (S.viewing) {
      const b = el('div', 'viewing');
      b.innerHTML = `צופה ב<b>${esc(S.viewing)}</b> · <button id="me" class="link">חזרה אליי</button>`;
      v.appendChild(b);
    }

    // change banner
    if (!S.viewing && S.changes && S.changes.mine && S.changes.at > S.lastSeen) {
      const c = S.changes.mine;
      const bits = [];
      if (c.added.length) bits.push('נוספו ' + c.added.length);
      if (c.removed.length) bits.push('בוטלו ' + c.removed.length);
      const bn = el('div', 'banner');
      bn.innerHTML = `<div class="bt">השבצ״ק עודכן. ${bits.join(' · ')} שמירות שלך</div>
        <div class="bl">${[...c.added.map(x => '+ ' + fmtShift(x, now)), ...c.removed.map(x => '− ' + fmtShift(x, now))].slice(0, 6).map(esc).join('<br>')}</div>
        <button class="link" id="seen">הבנתי</button>`;
      v.appendChild(bn);
      $('#seen').onclick = async () => { S.lastSeen = Date.now(); try { await api('/api/me', { sheet: S.sheet, seen: true }); } catch (e) { } render(); };
    }

    const hero = el('div', 'hero');
    if (st.current) {
      const left = st.current.e - now, total = st.current.e - st.current.s;
      const pct = Math.max(0, Math.min(100, 100 * (now - st.current.s) / total));
      const posts = [...new Set(st.active.map(s => s.p).filter(Boolean))];
      hero.classList.add('on');
      hero.innerHTML = `
        <div class="tag">עכשיו במשמרת</div>
        <div class="big" id="cd">${durHTML(left)}</div>
        <div class="lead">${posts.length ? esc(posts.join(' + ')) + ' · ' : ''}עד ${hm(D(st.current.e))}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        ${st.withMe.length ? row('איתך', st.withMe.join(', ')) : ''}
        ${st.relief.length ? row('מחליף אותך', st.relief.join(', ')) : ''}
        ${st.next ? row('הבא שלך', dayLabel(D(st.next.s), now) + ' ' + hm(D(st.next.s)) + (st.next.p ? ' · ' + st.next.p : '')) : ''}`;
    } else if (st.next) {
      const left = st.next.s - now, soon = left <= 45 * 60000;
      hero.classList.add(soon ? 'soon' : 'free');
      hero.innerHTML = `
        <div class="tag">${soon ? 'מתחיל עוד מעט' : 'זמן רפיסה'}</div>
        <div class="big" id="cd">${durHTML(left)}</div>
        <div class="lead">${dayLabel(D(st.next.s), now)} ב-${hm(D(st.next.s))}${st.next.p ? ' · ' + esc(st.next.p) : ''}</div>
        <div class="sub2">עד ${hm(D(st.next.e))}${st.next.t ? ' · ' + esc(st.next.t) : ''}</div>`;
    } else {
      const rn = resolveName(who);
      hero.classList.add('none');
      hero.innerHTML = `<div class="tag">אין שמירות</div><div class="big">זמן רפיסה</div>
        <div class="lead">${st.total ? 'כל השיבוצים שלך כבר עברו'
          : rn.missing ? 'השם הזה עדיין לא מופיע בשבצ״ק'
          : 'לא נמצאו שיבוצים על השם הזה'}</div>
        ${!st.total && rn.missing ? `<div class="sub2">ברגע שתשובץ, זה יתעדכן לבד ותקבל התראה.<br>
          <button class="link" id="rename">רשום אחרת בשבצ״ק? החלף שם</button></div>` : ''}`;
    }
    v.appendChild(hero);

    /* An announced time lands in the day like anything else — except for the
       people who are on a watch when it happens. They cannot be in two places,
       so it is not put in their list; the message itself still reaches them. */
    const rest = [...st.upcoming, ...evRows].sort((a, b) => a.s - b.s);
    if (rest.length || !S.viewing) {
      const head = el('div', 'lblrow');
      head.innerHTML = `<div class="sect">הבאים בתור</div>${S.viewing ? '' : '<button class="link sm" id="addmine">+ הוסף לעצמי</button>'}`;
      v.appendChild(head);
      const am = $('#addmine'); if (am) am.onclick = () => addPersonal();
      const list = el('div', 'list');
      let last = '';
      rest.slice(0, 60).forEach(s => {
        const dl = dayLabel(D(s.s), now);
        if (dl !== last) { last = dl; list.appendChild(el('div', 'daysep', esc(dl))); }
        const it = el('div', 'item' + (s.ev ? (s.mine ? ' evt mine' : ' evt') : ''));
        it.innerHTML = `<div class="t">${hm(D(s.s))}${s.ev && s.e <= s.s ? '' : `<span class="to">–${hm(D(s.e))}</span>`}</div>
          <div class="i"><div class="p">${esc(s.p || 'שמירה')}${
            s.ev ? `<span class="tagsm">${s.mine ? 'אישי' : (s.t ? esc(s.t) : 'אירוע')}</span>` : ''}</div>
          <div class="w">${durShort(s.s - now)}</div></div>`;
        if (s.mine) {
          it.style.cursor = 'pointer';
          it.onclick = async () => {
            if (!confirm('למחוק את "' + s.p + '"?')) return;
            try { await api(sq('/api/sheets/events'), { personal: true, remove: s.id }); await loadRoster(); render(); }
            catch (e) { toast(e.message); }
          };
        }
        list.appendChild(it);
      });
      if (!rest.length) list.appendChild(el('div', 'none sm', 'אין שיבוצים קרובים'));
      v.appendChild(list);
    }

    /* Two different clocks, and conflating them was actively misleading: how
       long since the שבצ״ק last CHANGED, and how long since the worker last
       LOOKED. A roster nobody has edited for three hours is healthy; a worker
       that hasn't looked for three hours is not, and that is the one worth
       shouting about — a cron killed by the free plan's CPU limit leaves no
       error behind, so silence is the only symptom. */
    const mins = t => (t ? Math.round((Date.now() - t) / 60000) : null);
    const ago = mins(S.roster.updatedAt);
    const checked = mins(S.roster.lastPoll);
    const ticked = mins(S.roster.lastTick);
    const stalled = S.roster.lastPoll != null &&
      (checked === null || checked > 20) && (ticked === null || ticked > 20);
    /* The real permission call needs a user gesture, and a cold browser prompt
       that gets dismissed is often unrecoverable. So: ask in the app first, then
       one tap opens the real dialog. */
    const canAsk = ('Notification' in window) && Notification.permission === 'default' &&
      !S.viewing && S.me && (platform() !== 'ios' || isStandalone()) &&
      Date.now() - (LS.get('notifAsked', 0) || 0) > 3 * 864e5;
    if (canAsk) {
      const n = el('div', 'banner');
      n.innerHTML = `<div class="bt">להפעיל התראות?</div>
        <div class="bl">תזכורת לפני כל שמירה, והתראה אם השבצ״ק משתנה. אפשר לכבות בכל רגע.</div>
        <button class="link" id="asknow">כן, הפעל</button> ·
        <button class="link" id="asklater">לא עכשיו</button>`;
      v.appendChild(n);
      $('#asknow').onclick = async () => {
        LS.set('notifAsked', Date.now());
        try {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') { toast('אפשר להפעיל אחר כך בהגדרות'); render(); return; }
          await subscribePush();
          // notifications with no reminder set would only cover roster changes
          if (!(S.roster && S.roster.remind)) {
            try { await api('/api/me', { sheet: S.sheet, remind: 15 }); if (S.roster) S.roster.remind = 15; } catch (e) { }
          }
          toast('התראות פעילות · תזכורת 15 דק׳ לפני שמירה');
        } catch (e) { toast(e.message); }
        render();
      };
      $('#asklater').onclick = () => { LS.set('notifAsked', Date.now()); render(); };
    }

    /* Offered once, after there is a name to show it against — a guide shown
       before the app has anything in it explains nothing. */
    if (!LS.get('guideSeen', 0) && !S.viewing && S.me) {
      const g = el('div', 'banner');
      g.innerHTML = `<div class="bt">פעם ראשונה כאן?</div>
        <div class="bl">מדריך קצר: מה המסך הזה אומר, ואיך מפעילים התראות.</div>
        <button class="link" id="gopen">קרא</button> ·
        <button class="link" id="gskip">לא צריך</button>`;
      v.appendChild(g);
      $('#gopen').onclick = screenGuide;
      $('#gskip').onclick = () => { LS.set('guideSeen', 1); render(); };
    }

    /* An admin's message, kept on the שבצ״ק as well as pushed — the people who
       most need to see "בדיקת נשק ב-08:50" are exactly the ones with
       notifications off. Dismissed per message, not per screen. */
    if (bc && bc.text && LS.get('bcastSeen', '') !== bc.id) {
      const n = el('div', 'banner msg');
      const aud = bc.to && bc.to.kind === 'people'
        ? (bc.to.group ? ' · ל' + bc.to.group : ' · לנבחרים') : '';
      n.innerHTML = `<div class="bt">${esc((bc.from ? 'הודעה מ' + bc.from : 'הודעה מהמפקד') + aud)}</div>
        <div class="bl">${esc(bc.text)}${bc.when
          ? `<br><b>${esc(dayLabel(D(bc.when), now))} ב-${hm(D(bc.when))}</b>${
              ev ? '' : ' <span class="dimmer">· אתה בשמירה אז</span>'}` : ''}</div>
        <button class="link" id="bcok">הבנתי</button>
        <span class="dimmer" style="margin-inline-start:8px">${esc(dayLabel(D(bc.at), now))} ${hm(D(bc.at))}</span>`;
      v.appendChild(n);
      $('#bcok').onclick = () => { LS.set('bcastSeen', bc.id); render(); };
    }

    if (!canAsk && !isStandalone() && !LS.get('installNagged', false) && !S.viewing) {
      const n = el('div', 'banner');
      n.innerHTML = `<div class="bt">הוסף למסך הבית</div>
        <div class="bl">${platform() === 'ios' ? 'באייפון זה תנאי לקבלת התראות.' : 'אייקון משלה, פתיחה מהירה והתראות.'}</div>
        <button class="link" id="shownag">איך עושים את זה</button> ·
        <button class="link" id="hidenag">לא עכשיו</button>`;
      v.appendChild(n);
      $('#shownag').onclick = screenInstall;
      $('#hidenag').onclick = () => { LS.set('installNagged', true); render(); };
    }

    const foot = el('div', 'foot');
    const health = S.offline ? '⚠ אין חיבור, מוצג מה שנשמר'
      : S.roster.lastError ? '⚠ ' + esc(S.roster.lastError)
      : stalled ? '⚠ השרת לא בדק כבר ' + (checked === null ? 'הרבה זמן' : checked + ' דק׳')
      : checked === null ? (ago === 0 || ago === null ? 'מסונכרן' : 'עודכן לפני ' + ago + ' דק׳')
      : checked < 2 ? 'נבדק עכשיו' : 'נבדק לפני ' + checked + ' דק׳';
    foot.innerHTML = `<span>${health}</span>
      <button class="link" id="rf">${S.loading ? 'בודק…' : 'בדוק עכשיו'}</button>`;
    v.appendChild(foot);

    $('#who').onclick = () => { S.viewing = null; screenPick(false); };
    const rnb = $('#rename'); if (rnb) rnb.onclick = () => { S.viewing = null; screenPick(false); };
    $('#board').onclick = screenBoard;
    $('#other').onclick = () => screenPick(true);
    $('#cfg').onclick = screenSettings;
    $('#rf').onclick = async () => { S.loading = true; render(); try { await api(sq('/api/refresh'), {}); await loadRoster(); } catch (e) { toast(e.message); } S.loading = false; render(); };
    if (S.viewing) $('#me').onclick = () => { S.viewing = null; route(); };
  }
  const row = (k, v2) => `<div class="row"><span class="k">${k}</span><span class="vl">${esc(v2)}</span></div>`;
  function fmtShift(x, now) {
    return dayLabel(new Date(x.s), now) + ' ' + hm(new Date(x.s)) + (x.p ? ' · ' + x.p : '');
  }

  /* ---------- settings ---------- */
  /* Written for the eighteen-year-old who was handed a link and told "install
     this". Short, in the order he will need it, and it says what the app will
     NOT do — the fastest way to lose someone is to let him assume it covers
     something it doesn't. */
  function screenGuide() {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    const ios = platform() === 'ios';
    c.innerHTML = `
      <div class="logo sm">איך זה עובד</div>
      <p class="sub">דקה של קריאה, ואתה מסודר.</p>

      <div class="sect">1 · המסך הראשי</div>
      <div class="guide">
        <p>המסגרת הגדולה למעלה עונה על שאלה אחת: <b>מה עכשיו</b>.</p>
        <p><span class="dot on"></span> <b>אדום</b>. אתה בשמירה עכשיו, וכתוב עד מתי.</p>
        <p><span class="dot soon"></span> <b>כתום</b>. השמירה הבאה מתקרבת, והמספר הגדול אומר כמה נשאר.</p>
        <p><span class="dot free"></span> <b>ירוק</b>. זמן רפיסה.</p>
        <p>מתחת לזה <b>הבאים בתור</b>: כל מה שמחכה לך, לפי הסדר.</p>
      </div>

      <div class="sect">2 · השם שלך</div>
      <div class="guide">
        <p>לחיצה על השם למעלה מחליפה אותו. אפשר לחפש איך שנוח: <span dir="ltr">oso</span>, אוסוביצקי, או עם שגיאת כתיב. זה ימצא.</p>
        <p>אם כותבים לך את השם קצת אחרת בכל שבוע זה בסדר, האפליקציה מזהה. והשם שבחרת נשאר גם בשבוע שלא שובצת בו בכלל.</p>
      </div>

      <div class="sect">3 · התראות</div>
      <div class="guide">
        ${ios ? `<p><b>באייפון חייבים קודם להוסיף למסך הבית.</b> שיתוף ⬆︎ בסרגל התחתון ← הוספה למסך הבית ← לפתוח משם. בלי זה אפל לא נותנת התראות, וזו לא בחירה שלנו.</p>` : ''}
        <p>שתי התראות שונות:</p>
        <p>· <b>לפני שמירה</b>. 15 דקות לפני, או כמה שתבחר.</p>
        <p>· <b>כשהשבצ״ק משתנה</b>, אבל רק אם השינוי נוגע <i>לך</i>. לא תקבל התראה על שמירה של מישהו אחר.</p>
        <p>שניהם בהגדרות, ואפשר לכבות בכל רגע.</p>
        <p>ויש גם <b>מספר קטן על אייקון האפליקציה</b>, שאומר כמה שמירות יש לך ב-24 השעות הקרובות. הוא מתעדכן לבד ואפשר לראות אותו בלי לפתוח כלום. צריך שהאפליקציה תהיה במסך הבית ושההתראות יאושרו.</p>
      </div>

      <div class="sect">4 · מה עוד יש</div>
      <div class="guide">
        <p><b>${'מי בשמירה עכשיו'}</b>, האייקון עם האנשים למעלה. כל העמדות ומי עליהן, ולשונית עם המפקדים והקצינים והטלפונים שלהם. לחיצה על מספר מחייגת.</p>
        <p><b>הוסף לעצמי</b>, ליד "הבאים בתור". משהו שאתה צריך לזכור, בשעה שתבחר. רק אתה רואה אותו.</p>
      </div>

      <div class="sect">5 · מה זה לא</div>
      <div class="guide">
        <p>האפליקציה <b>קוראת בלבד</b>. היא לא משנה את השבצ״ק, לא מחליפה לך שמירה ולא מודיעה למפקד. אם צריך להחליף, מדברים עם מי שאחראי כמו תמיד.</p>
        <p>מה שמופיע כאן הוא מה שכתוב בשבצ״ק. אם משהו נראה לא נכון, כנראה ככה זה רשום. תראה למי שמנהל אותו.</p>
      </div>

      <button id="gdone" class="btn primary">הבנתי</button>
      <button id="gback" class="btn ghost">חזרה</button>`;
    v.appendChild(c);
    LS.set('guideSeen', 1);
    $('#gdone').onclick = route;
    $('#gback').onclick = () => (S.roster && S.me ? screenSettings() : route());
  }

  /* ---------- pages made of a menu ----------
     Settings used to be one page you scrolled for half a minute, with the two
     things a normal soldier needs buried between eighteen he never touches.
     Now every screen asks one question and shows one topic. */
  function menuPage(o) {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    c.innerHTML = `<div class="logo sm">${esc(o.title)}</div>` +
      (o.sub ? `<p class="sub">${esc(o.sub)}</p>` : '');
    const m = el('div', 'menu');
    if (o.menuId) m.id = o.menuId;
    c.appendChild(m);
    v.appendChild(c);
    menuRows(m, o.rows || []);
    if (o.after) o.after(c, m);
    if (o.back) {
      const b = el('button', 'btn ghost', o.back.label || 'חזרה');
      b.id = o.back.id || 'back';
      b.onclick = o.back.fn;
      c.appendChild(b);
    }
    return c;
  }
  function menuRows(host, rows) {
    rows.filter(Boolean).forEach(r => {
      const b = el('button', 'mrow' + (r.hot ? ' hot' : ''));
      if (r.id) b.id = r.id;
      b.innerHTML = `<span class="mi">${r.icon || ''}</span>
        <span class="mt"><b>${esc(r.label)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
        <span class="mc">›</span>`;
      b.onclick = r.fn;
      host.appendChild(b);
    });
    return host;
  }
  /* One topic on its own page. Returns the box to fill. */
  function subPage(title, note, back) {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    c.innerHTML = `<div class="logo sm">${esc(title)}</div>` + (note ? `<p class="sub">${esc(note)}</p>` : '');
    const host = el('div');
    host.id = 'subwrap';
    c.appendChild(host);
    const b = el('button', 'btn ghost', 'חזרה');
    b.id = 'backsub';
    b.onclick = back;
    c.appendChild(b);
    v.appendChild(c);
    return host;
  }

  /* ============================ ניהול ============================ */
  /* Everything only a מנהל does. A normal soldier never sees this door. */
  function screenAdmin() {
    const native = isNative();
    menuPage({
      title: 'ניהול השבצ״ק',
      sub: (S.roster && S.roster.title) || '',
      menuId: 'adminwrap',
      rows: [
        native ? { id: 'nav-edit', icon: '✎', label: 'עריכת השבצ״ק', note: 'להזיז אנשים, להוסיף ימים, למלא מחדש', fn: () => screenEdit(), hot: true } : null,
        { id: 'nav-people', icon: '👥', label: 'אנשים והרשאות', note: 'מי בפנים, הזמנות וקישור לקבוצה', fn: admPeople },
        { id: 'nav-groups', icon: '🏷', label: 'קבוצות', note: 'פיקוד, מחלקה, כל רשימה שתרצה', fn: admGroups },
        { id: 'nav-msg', icon: '📣', label: 'הודעות ולוז', note: 'הודעה לכולם או לקבוצה, ולוז שלם בהדבקה', fn: admMsg },
        { id: 'nav-contacts', icon: '📞', label: 'מפקדים וקצינים', note: 'שמות ומספרי טלפון', fn: admContacts },
        native ? null : { id: 'nav-read', icon: '📄', label: 'איך קוראים את הגיליון', note: 'עמודות מוסתרות וכללי עמודות', fn: admRead },
      ],
      back: { id: 'backadm', label: 'חזרה להגדרות', fn: screenSettings },
    });
  }

  async function admContacts() {
    const host = subPage('מפקדים וקצינים', 'מי שרשום כאן מופיע במסך "מי בשמירה עכשיו" עם הטלפון שלו.', screenAdmin);
    contactsEditor(host, S.sheet);
  }

  /* ---- אנשים: בקשות, הזמנות, קישור קבוצתי, מצב פתוח, חברים ---- */
  async function admPeople() {
    const host = subPage('אנשים והרשאות', '', screenAdmin);
    const loading = el('div', 'none sm', 'טוען…');
    host.appendChild(loading);
    let m;
    try { m = await api(sq('/api/sheets/members')); }
    catch (e) { loading.remove(); host.appendChild(el('div', 'err', e.message)); return; }
    let reqs = { requests: [] };
    try { reqs = await api(sq('/api/sheets/requests')); } catch (e) { }
    let GROUPS = [];
    try { GROUPS = (await api(sq('/api/sheets/groups'))).groups || []; } catch (e) { }
    loading.remove();

    /* One link for a whole group, with a clock on it. Unlike the single-use
       codes it can be pasted once into a WhatsApp group — and unlike מצב פתוח
       it doesn't need anyone to have the Sheets link at all. */
    const linkBox = el('div');
    const renderLink = () => {
      const L = m.link, left = L ? L.until - Date.now() : 0;
      const url = L ? location.origin + location.pathname + '#g=' + L.code : '';
      linkBox.innerHTML = `<div class="sect">קישור קבוצתי</div>
        <div class="note">קישור אחד לכולם, שנסגר לבד כשהזמן נגמר. מי שפותח אותו נכנס לשבצ״ק בלי אישור.</div>
        ${L && left > 0
          ? `<div class="invrow" dir="ltr" id="glink">${esc(url)}</div>
             <div class="openon">פעיל · ${fmtLeft(left)}${L.max ? ` · ${L.used}/${L.max} הצטרפו` : L.used ? ` · ${L.used} הצטרפו` : ''}${
               L.group ? ' · מצרף ל' + esc(L.group) : ''}</div>
             <div class="inline">
               <button id="gcopy" class="btn ghost sm">העתק</button>
               ${navigator.share ? '<button id="gshare" class="btn ghost sm">שתף</button>' : ''}
               <button id="gkill" class="btn ghost sm">בטל קישור</button>
             </div>`
          : `<div class="inline">
               <button class="btn ghost sm gw" data-m="60">שעה</button>
               <button class="btn ghost sm gw" data-m="1440">24 שעות</button>
               <button class="btn ghost sm gw" data-m="10080">שבוע</button>
             </div>
             <div class="inline"><label class="note" for="gmax">מקסימום מצטרפים (0 = בלי הגבלה)</label>
               <input id="gmax" class="inp" type="number" value="0" min="0" max="500"></div>
             <div class="inline"><label class="note" for="ggrp">מצרף אוטומטית לקבוצה</label>
               <select id="ggrp" class="sel wide"><option value="">בלי</option>${
                 GROUPS.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('')}</select></div>`}`;
      const set = async (minutes, max, group) => {
        try {
          const r = await api('/api/sheets/link', { sheet: S.sheet, minutes, max: max || 0, group: group || '' });
          m.link = r.link; renderLink();
          toast(minutes ? 'הקישור נוצר' : 'הקישור בוטל');
        } catch (e) { toast(e.message); }
      };
      linkBox.querySelectorAll('.gw').forEach(b =>
        b.onclick = () => set(+b.dataset.m, +(($('#gmax') || {}).value || 0), (($('#ggrp') || {}).value || '')));
      const kill = $('#gkill'); if (kill) kill.onclick = () => set(0);
      const cp = $('#gcopy');
      if (cp) cp.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('הועתק'); };
      const sh = $('#gshare');
      if (sh) sh.onclick = () => navigator.share({ title: 'הצטרפו לשבצ״ק', text: 'הצטרפו לשבצ״ק:', url }).catch(() => { });
    };

    // open enrolment window
    const openBox = el('div');
    const renderOpen = () => {
      const left = (m.openUntil || 0) - Date.now();
      openBox.innerHTML = `<div class="sect">מצב פתוח</div>
        <div class="note">כל מי שמדביק את הקישור לשבצ״ק נכנס בלי אישור, עד שהחלון נסגר. שימושי כשמצרפים פלוגה שלמה בבת אחת.</div>
        ${left > 0
          ? `<div class="openon">פתוח · נסגר בעוד ${Math.ceil(left / 60000)} דק׳</div>
             <button id="openoff" class="btn ghost sm">סגור עכשיו</button>`
          : `<div class="inline">
               <button class="btn ghost sm ow" data-m="15">15 דק׳</button>
               <button class="btn ghost sm ow" data-m="60">שעה</button>
               <button class="btn ghost sm ow" data-m="1440">24 שעות</button>
             </div>`}`;
      openBox.querySelectorAll('.ow').forEach(b => b.onclick = async () => {
        try {
          const r = await api('/api/sheets/open', { sheet: S.sheet, minutes: +b.dataset.m });
          toast(r.approved ? 'נפתח · אושרו ' + r.approved + ' בקשות ממתינות' : 'נפתח');
          admPeople();
        } catch (e) { toast(e.message); }
      });
      const off = $('#openoff');
      if (off) off.onclick = async () => {
        try { await api('/api/sheets/open', { sheet: S.sheet, minutes: 0 }); toast('נסגר'); admPeople(); }
        catch (e) { toast(e.message); }
      };
    };

    const panel = el('div');
    host.appendChild(panel);
    panel.innerHTML = (reqs.requests.length ? `<div class="sect">בקשות הצטרפות (${reqs.requests.length})</div><div id="reqs"></div>` : '') +
      `<div class="sect">הזמנות</div>
      <div class="note">כל קישור נשרף אחרי שימוש אחד ונצמד לחשבון של מי שפתח אותו.</div>
      <div class="inline"><input id="ninv" class="inp" type="number" value="5" min="1" max="40"><button id="mkinv" class="btn ghost sm">צור קישורים</button></div>
      <div id="invout"></div>`;
    host.appendChild(linkBox); renderLink();
    host.appendChild(openBox); renderOpen();

    const memBox = el('div');
    memBox.innerHTML = `<div class="sect">חברים (${m.members.length})</div><div id="mem"></div>`;
    host.appendChild(memBox);

    const rq = $('#reqs');
    if (rq) reqs.requests.forEach(x => {
      const row = el('div', 'crow');
      row.innerHTML = `<span>${esc(x.name || x.email || x.account)}<br><small class="dimmer">${esc(x.email || '')}</small></span>`;
      const box = el('span');
      const yes = el('button', 'link sm', 'אשר');
      const no = el('button', 'link danger sm', 'דחה');
      no.style.marginInlineStart = '10px';
      yes.onclick = async () => { try { await api('/api/sheets/approve', { sheet: S.sheet, account: x.account }); admPeople(); } catch (e) { toast(e.message); } };
      no.onclick = async () => { try { await api('/api/sheets/deny', { sheet: S.sheet, account: x.account }); admPeople(); } catch (e) { toast(e.message); } };
      box.appendChild(yes); box.appendChild(no);
      row.appendChild(box);
      rq.appendChild(row);
    });

    const mem = $('#mem');
    const iAmOwner = m.owner === S.account;
    const how = v => v === 'sheets' ? 'גישה ישירה' : v === 'created' ? 'יצר את השבצ״ק' : v === 'invite' ? 'הזמנה' : v === 'link' ? 'קישור קבוצתי' : v === 'open' ? 'מצב פתוח' : 'בקשה';
    m.members.forEach(x => {
      const isOwner = x.account === m.owner;
      const isAdmin = isOwner || x.role === 'admin';
      const row = el('div', 'crow');
      row.innerHTML = `<span>${esc(x.person || x.name || x.email || x.account)}
        ${isOwner ? '<b class="tagsm own">בעלים</b>' : isAdmin ? '<b class="tagsm">מנהל</b>' : ''}
        <br><small class="dimmer">${esc(x.email || '')} · ${how(x.via)}</small></span>`;
      const box = el('span', 'acts');
      if (!isOwner) {
        const t = el('button', 'link sm', isAdmin ? 'הסר ניהול' : 'הפוך למנהל');
        t.onclick = async () => {
          try { await api('/api/sheets/role', { sheet: S.sheet, account: x.account, role: isAdmin ? 'member' : 'admin' }); admPeople(); }
          catch (e) { toast(e.message); }
        };
        box.appendChild(t);
      }
      if (iAmOwner && !isOwner) {
        const o = el('button', 'link sm', 'העבר בעלות');
        o.onclick = async () => {
          if (!confirm('להעביר את הבעלות על השבצ״ק ל' + (x.person || x.email) + '? אתה תישאר מנהל.')) return;
          try { await api('/api/sheets/owner', { sheet: S.sheet, account: x.account }); admPeople(); }
          catch (e) { toast(e.message); }
        };
        box.appendChild(o);
      }
      if (x.account !== S.account && !isOwner) {
        const b2 = el('button', 'link danger sm', 'הסר');
        b2.onclick = async () => {
          if (!confirm('להסיר את ' + (x.person || x.email) + '?')) return;
          try { await api('/api/sheets/revoke', { sheet: S.sheet, account: x.account }); admPeople(); }
          catch (e) { toast(e.message); }
        };
        box.appendChild(b2);
      }
      row.appendChild(box);
      mem.appendChild(row);
    });
    mem.appendChild(el('div', 'note', 'מנהל יכול לאשר בקשות, ליצור הזמנות ו' +
      (isNative() ? 'לערוך את השבצ״ק' : 'לשנות כללי עמודות') + '. הבעלים יכול גם למנות ולהוריד מנהלים.'));

    $('#mkinv').onclick = async () => {
      try {
        const r = await api('/api/sheets/invite', { sheet: S.sheet, count: +$('#ninv').value || 1 });
        const base = location.origin + location.pathname;
        $('#invout').innerHTML = `<div class="note">שלח לכל אחד קישור אחד:</div>` +
          r.codes.map(c => `<div class="invrow" dir="ltr">${esc(base)}#i=${esc(c)}</div>`).join('') +
          `<button id="copyinv" class="btn ghost sm">העתק הכל</button>`;
        $('#copyinv').onclick = () => {
          navigator.clipboard && navigator.clipboard.writeText(r.codes.map(c => base + '#i=' + c).join('\n'));
          toast('הועתק');
        };
      } catch (e) { toast(e.message); }
    };
  }

  /* ---- קבוצות ---- */
  async function admGroups() {
    const host = subPage('קבוצות', 'קבוצה היא רשימת שמות מהשבצ״ק, למשל פיקוד או מחלקה א׳, כדי לשלוח הודעה רק להם.', screenAdmin);
    let GROUPS = [];
    try { GROUPS = (await api(sq('/api/sheets/groups'))).groups || []; } catch (e) { }
    const box = el('div');
    host.appendChild(box);
    const save = async () => {
      try {
        const r = await api(sq('/api/sheets/groups'), { groups: GROUPS });
        GROUPS = r.groups; if (S.roster) S.roster.groups = GROUPS;
        draw(); toast('נשמר');
      } catch (e) { toast(e.message); }
    };
    const draw = () => {
      box.innerHTML = `<div id="glist"></div>
        <div class="inline"><input id="gname" class="inp" placeholder="שם קבוצה חדשה"><button id="gadd" class="btn ghost sm">צור</button></div>`;
      const gl = $('#glist');
      GROUPS.forEach((g, i) => {
        const row = el('div', 'crow');
        row.innerHTML = `<span>${esc(g.name)}<br><small class="dimmer">${g.people.length} אנשים · ${esc(g.people.slice(0, 3).join(', '))}${g.people.length > 3 ? '…' : ''}</small></span>`;
        const acts = el('span', 'acts');
        const ed = el('button', 'link sm', 'ערוך');
        ed.onclick = () => pickPeople('מי בקבוצת ' + g.name, (S.roster && S.roster.names) || [], g.people, async people => {
          GROUPS[i] = { name: g.name, people };
          await save();
        });
        const rm = el('button', 'link danger sm', 'מחק');
        rm.onclick = async () => { if (!confirm('למחוק את ' + g.name + '?')) return; GROUPS.splice(i, 1); await save(); };
        acts.appendChild(ed); acts.appendChild(rm);
        row.appendChild(acts);
        gl.appendChild(row);
      });
      if (!GROUPS.length) gl.appendChild(el('div', 'none sm', 'אין קבוצות'));
      $('#gadd').onclick = () => {
        const name = $('#gname').value.trim();
        if (!name) return;
        pickPeople('מי ב' + name, (S.roster && S.roster.names) || [], [], async people => {
          if (!people.length) return toast('לא נבחר אף אחד');
          GROUPS.push({ name, people });
          await save();
        });
      };
    };
    draw();
  }

  /* ---- הודעות ולוז ---- */
  async function admMsg() {
    const host = subPage('הודעות ולוז', 'הודעה מגיעה כהתראה ונשארת על המסך הראשי עד שסוגרים אותה.', screenAdmin);
    let GROUPS = [];
    try { GROUPS = (await api(sq('/api/sheets/groups'))).groups || []; } catch (e) { }
    let TO = { kind: 'all' };
    const today = (() => { const p2 = zparts(new Date()); return p2.y + '-' + pad(p2.mo) + '-' + pad(p2.d); })();
    const box = el('div');
    box.innerHTML = `<div class="sect">למי</div>
      <div class="chips" id="bcto"></div>

      <div class="sect">הודעה</div>
      <div class="note">עד 200 תווים.</div>
      <textarea id="bctxt" class="inp ta" placeholder="למשל: בדיקת נשק ליד החמ״ל"></textarea>
      <label class="opt"><input type="checkbox" id="bchas">
        <span>יש לזה שעה. יתווסף ליום של כולם, חוץ ממי שבשמירה באותו רגע</span></label>
      <div id="bcwhen" class="grid2" style="display:none">
        <div><label class="lbl">תאריך</label><input id="bcd" class="inp" type="date" value="${esc(today)}"></div>
        <div><label class="lbl">שעה</label><input id="bch" class="inp" type="time" value="08:00"></div>
      </div>
      <div class="inline"><button id="bcsend" class="btn ghost sm">שלח</button>
        <button id="bcclear" class="btn ghost sm">הסר הודעה קיימת</button></div>

      <div class="sect">לוז</div>
      <div class="note">הדבק לוז שלם. כל שורה היא שעה אחת, וברגע שהיא עוברת מוצג הסעיף הבא. הכותרת מזוהה לבד. נשלח לנמענים שבחרת למעלה.</div>
      <textarea id="lztxt" class="inp ta big2" placeholder="לוז ליציאה:&#10;11:00 אפסון צלמים&#10;11:30 ארוחת צהריים&#10;12:25 מסדרי חדרים&#10;12:40 תדרוך"></textarea>
      <div class="grid2">
        <div><label class="lbl">תאריך</label><input id="lzd" class="inp" type="date" value="${esc(today)}"></div>
        <div><label class="lbl">התראה</label><select id="lzn" class="sel wide">
          <option value="1">שלח התראה</option><option value="0">בשקט, רק ביומן</option></select></div>
      </div>
      <div id="lzprev"></div>
      <div class="inline"><button id="lzsend" class="btn ghost sm">פרסם לוז</button>
        <button id="lzclear" class="btn ghost sm">נקה לוז קיים</button></div>`;
    host.appendChild(box);

    /* Who gets it. Default is everyone, because that is usually right and a
       wrong default here means somebody misses a מסדר. */
    function drawTargets() {
      const t = $('#bcto'); if (!t) return;
      const chip = (label, on, fn) => {
        const b = el('button', 'chip' + (on ? ' on' : ''), esc(label));
        b.onclick = fn; t.appendChild(b);
      };
      t.innerHTML = '';
      chip('כולם', TO.kind === 'all', () => { TO = { kind: 'all' }; drawTargets(); });
      GROUPS.forEach(g => chip(g.name + ' · ' + g.people.length,
        TO.kind === 'people' && TO.group === g.name,
        () => { TO = { kind: 'people', group: g.name, names: g.people.slice() }; drawTargets(); }));
      chip(TO.kind === 'people' && !TO.group ? 'נבחרו ' + TO.names.length : 'בחר אנשים',
        TO.kind === 'people' && !TO.group,
        () => pickPeople('למי לשלוח', (S.roster && S.roster.names) || [],
          (TO.kind === 'people' && !TO.group) ? TO.names : [], names => {
            TO = names.length ? { kind: 'people', group: '', names } : { kind: 'all' };
            drawTargets();
          }));
    }
    drawTargets();

    const hasWhen = $('#bchas');
    hasWhen.onchange = () => { $('#bcwhen').style.display = hasWhen.checked ? '' : 'none'; };
    const send = async force => {
      const text = $('#bctxt').value.trim();
      if (text.length < 2) return toast('כתוב משהו קודם');
      let at = 0, mins = 0, when = '';
      if (hasWhen.checked) {
        const dparts = ($('#bcd').value || '').split('-').map(Number);
        const tparts = ($('#bch').value || '').split(':').map(Number);
        if (dparts.length !== 3 || tparts.length < 2) return toast('בחר תאריך ושעה');
        at = NA().zonedEpoch(dparts[0], dparts[1], dparts[2], tparts[0], tparts[1], TZ());
        when = '\n' + dayLabel(D(at), new Date()) + ' ' + hm(D(at));
      }
      const whoTo = TO.kind === 'all' ? 'לכל מי שבשבצ״ק'
        : TO.group ? 'ל' + TO.group + ' (' + TO.names.length + ')'
        : 'ל-' + TO.names.length + ' אנשים';
      if (!confirm('לשלוח ' + whoTo + '?\n\n' + text + when)) return;
      $('#bcsend').textContent = 'שולח…';
      try {
        const r = await api('/api/sheets/broadcast', { sheet: S.sheet, text, at, mins, to: TO, force });
        $('#bctxt').value = '';
        toast('נשלח ל-' + r.sent + ' מתוך ' + r.members);
        try { await loadRoster(); } catch (e) { }
      } catch (e) {
        if (e.tooSoon && confirm(e.message + '\n\nלשלוח בכל זאת?')) return send(true);
        toast(e.message);
      }
      $('#bcsend').textContent = 'שלח';
    };
    $('#bcsend').onclick = () => send(false);

    const lzParse = () => NA().parseLuz($('#lztxt').value);
    const lzDraw = () => {
      const r = lzParse(), b2 = $('#lzprev');
      if (!r.items.length) { b2.innerHTML = ''; return; }
      b2.innerHTML = `<div class="card">${r.title ? `<div class="crow"><span>כותרת</span><b>${esc(r.title)}</b></div>` : ''}` +
        r.items.map(i => `<div class="crow"><span>${esc(i.text)}</span><b>${pad(i.h)}:${pad(i.mi)}</b></div>`).join('') +
        '</div>';
    };
    $('#lztxt').oninput = lzDraw;
    $('#lzsend').onclick = async () => {
      const r = lzParse();
      if (!r.items.length) return toast('לא זוהו שורות עם שעה');
      const dp = ($('#lzd').value || '').split('-').map(Number);
      if (dp.length !== 3) return toast('בחר תאריך');
      const items = r.items.map(i => ({ at: NA().zonedEpoch(dp[0], dp[1], dp[2], i.h, i.mi, TZ()), text: i.text }));
      const whoTo = TO.kind === 'all' ? 'לכולם' : TO.group ? 'ל' + TO.group : 'ל-' + TO.names.length + ' אנשים';
      if (!confirm('לפרסם ' + r.items.length + ' סעיפים ' + whoTo + '?')) return;
      $('#lzsend').textContent = 'שולח…';
      try {
        const res = await api(sq('/api/sheets/events'), { items, title: r.title, to: TO, notify: $('#lzn').value === '1' });
        $('#lztxt').value = ''; lzDraw();
        toast('פורסמו ' + res.added + ' סעיפים');
        try { await loadRoster(); } catch (e) { }
      } catch (e) { toast(e.message); }
      $('#lzsend').textContent = 'פרסם לוז';
    };
    $('#lzclear').onclick = async () => {
      if (!confirm('למחוק את כל הסעיפים שפורסמו?')) return;
      try { await api(sq('/api/sheets/events'), { clearAll: true }); toast('נוקה'); try { await loadRoster(); } catch (e) { } }
      catch (e) { toast(e.message); }
    };
    $('#bcclear').onclick = async () => {
      try { await api('/api/sheets/broadcast', { sheet: S.sheet, clear: true }); toast('הוסרה'); try { await loadRoster(); } catch (e) { } }
      catch (e) { toast(e.message); }
    };
  }

  /* ---- how the sheet is read: hidden columns, and per-column rules ---- */
  async function admRead() {
    const host = subPage('איך קוראים את הגיליון', '', screenAdmin);
    let rr;
    try { rr = await api(sq('/api/sheets/rules')); }
    catch (e) { host.appendChild(el('div', 'err', e.message)); return; }

    /* A column somebody hid in the sheet is almost always a post that was
       retired or a scratch copy. Reading it puts people on watches that don't
       exist, so by default we walk past it — but it stays one tap away, because
       once in a while a column is hidden just to make the sheet narrower. */
    const hb = el('div');
    const drawHidden = () => {
      const keep = rr.hidden === 'keep';
      hb.innerHTML = `<div class="sect">עמודות מוסתרות</div>
        <div class="note">${rr.hiddenCount
          ? 'בגיליון יש ' + rr.hiddenCount + ' עמודות מוסתרות.'
          : 'לא נמצאו עמודות מוסתרות בגיליון.'}
          בדרך כלל מסתירים עמודה כי היא כבר לא בשימוש, ולכן אנחנו מדלגים עליה.</div>
        <div class="chips" id="hch"></div>
        <div class="note">${keep
          ? 'כרגע קוראים גם עמודות מוסתרות. אם מופיעות עמדות שאף אחד לא מכיר, זו כנראה הסיבה.'
          : 'כרגע מדלגים עליהן. אם עמדה אמיתית לא מופיעה באפליקציה, בדוק אם היא מוסתרת בגיליון.'}</div>`;
      const ch = $('#hch');
      [['skip', 'דלג עליהן'], ['keep', 'קרא גם אותן']].forEach(([val, label]) => {
        const b = el('button', 'chip' + ((rr.hidden === 'keep' ? 'keep' : 'skip') === val ? ' on' : ''), label);
        b.id = 'hid-' + val;
        b.onclick = async () => {
          if ((rr.hidden === 'keep' ? 'keep' : 'skip') === val) return;
          b.textContent = 'רגע…';
          try {
            const r = await api(sq('/api/sheets/rules'), { hidden: val });
            rr.hidden = r.hidden; rr.hiddenCount = r.hiddenCount;
            await loadRoster();
            drawHidden(); toast('נשמר, הגיליון נקרא מחדש');
          } catch (e) { toast(e.message); drawHidden(); }
        };
        ch.appendChild(b);
      });
    };
    host.appendChild(hb); drawHidden();

    /* One row per column, and a real sheet has twenty. Folded shut so the page
       opens short — almost nobody needs to change these. */
    const box = el('details', 'help');
    box.innerHTML = `<summary>כללי עמודות (${(rr.posts || []).length})</summary>
      <div class="note">עמודה רגילה הולכת לפי השעות שבשורה. עמודה יומית מתחילה בשעה קבועה, וכל מי שרשום בה באותו יום נמצא יחד.<br>
        <b>ממשיך ליום ריק</b>. אם ביום הבא העמודה ריקה, אותם אנשים ממשיכים גם בו. בשביל מטבח שנכתב פעם אחת ומכסה שישי ושבת. לא ממשיך יותר מיום אחד, ורשום באזהרות.</div>
      <div id="rules"></div><button id="saverules" class="btn ghost sm">שמור כללים</button>`;
    host.appendChild(box);
    const rl = $('#rules');
    const state = {};
    (rr.posts || []).forEach(post => {
      const cur = rr.rules[nk(post)] || null;
      state[post] = cur ? { mode: 'daily', start: cur.start, end: cur.end, carry: !!cur.carry }
                        : { mode: 'slot', start: '07:00', end: '23:59', carry: false };
      const row = el('div', 'rule');
      row.innerHTML = `<div class="rname">${esc(post)}</div>
        <select class="sel"><option value="slot">לפי השעות בשורה</option><option value="daily">יומי משעה קבועה</option></select>
        <span class="times"><input class="tin" type="time" value="${esc(state[post].start)}"><input class="tin" type="time" value="${esc(state[post].end)}"></span>
        <label class="carry"><input type="checkbox" class="cy"${state[post].carry ? ' checked' : ''}> ממשיך ליום ריק</label>`;
      const sel = row.querySelector('select'), tw = row.querySelector('.times');
      const ins = row.querySelectorAll('.tin');
      const cy = row.querySelector('.cy'), cl = row.querySelector('.carry');
      sel.value = state[post].mode;
      const sync = () => {
        const daily = sel.value === 'daily';
        tw.style.visibility = daily ? 'visible' : 'hidden';
        cl.style.display = daily ? '' : 'none';
        state[post].mode = sel.value;
      };
      sel.onchange = sync; sync();
      ins[0].onchange = () => state[post].start = ins[0].value;
      ins[1].onchange = () => state[post].end = ins[1].value;
      cy.onchange = () => state[post].carry = cy.checked;
      rl.appendChild(row);
    });
    if (!(rr.posts || []).length) rl.appendChild(el('div', 'none sm', 'אין עמודות עדיין'));
    $('#saverules').onclick = async () => {
      const payload = {};
      Object.entries(state).forEach(([post, v]) => { if (v.mode === 'daily') payload[post] = v; });
      $('#saverules').textContent = 'שומר…';
      try { await api(sq('/api/sheets/rules'), { rules: payload }); await loadRoster(); toast('נשמר'); screenAdmin(); }
      catch (e) { toast(e.message); $('#saverules').textContent = 'שמור כללים'; }
    };
  }

  /* ============================ הגדרות ============================ */
  function notifSummary() {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    const r = (S.roster && S.roster.remind) || 0;
    if (perm !== 'granted') return 'כבויות. אפשר להפעיל';
    return 'פעילות' + (r ? ' · תזכורת ' + (r === 60 ? 'שעה' : r + ' דק׳') + ' לפני שמירה' : ' · בלי תזכורת לפני שמירה');
  }

  async function screenSettings() {
    const rows = [
      { id: 'guide', icon: '📖', label: 'איך זה עובד', note: 'מדריך קצר, דקה של קריאה', fn: screenGuide },
      { id: 'nav-notif', icon: '🔔', label: 'התראות ותזכורות', note: notifSummary(), fn: setNotif },
      { id: 'nav-sheets', icon: '📋', label: 'השבצ״קים שלי', note: S.sheets.length === 1 ? ((S.sheets[0] || {}).title || 'אחד') : S.sheets.length + ' שבצ״קים', fn: setSheets },
      { id: 'nav-me', icon: '👤', label: 'הפרטים שלי', note: (S.me || 'לא נבחר') + ' · כינויים ומכשירים', fn: setMe },
      { id: 'nav-tools', icon: '📊', label: 'כלים', note: 'טבלת שעות, ייצוא, אבחון', fn: setTools },
    ];
    menuPage({
      title: 'הגדרות',
      sub: (S.roster && S.roster.title) || '',
      menuId: 'setmenu',
      rows,
      back: { id: 'back', label: 'חזרה', fn: route },
    });
    /* One cheap call decides whether this person sees the management door at
       all. A member who can't do any of it shouldn't be shown a locked room. */
    if (S.sheet) {
      let admin = false;
      try { admin = !!(await api(sq('/api/sheets/contacts'))).admin; } catch (e) { }
      const host = $('#setmenu');
      if (host && admin) {
        const door = menuRows(el('div'), [{
          id: 'nav-admin', icon: '🛠', hot: true, label: 'ניהול השבצ״ק',
          note: 'חברים, קבוצות, הודעות, אנשי קשר' + (isNative() ? ', ועריכה' : ''), fn: screenAdmin,
        }]).firstChild;
        host.insertBefore(door, host.children[2] || null);
      }
    }
  }

  function setNotif() {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const host = subPage('התראות ותזכורות', '', screenSettings);
    const box = el('div');
    box.innerHTML = `
      <div class="sect">שינוי בשבצ״ק</div>
      <div class="note">התראה רק כשמשהו נוגע לך. לא על שמירות של אחרים.</div>
      ${perm === 'denied' ? `<div class="warnbox">התראות חסומות בדפדפן. כדי להפעיל:<br>
             ${iOS ? 'הגדרות iPhone ← התראות ← שבצ״ק' : 'לחץ על אייקון הנעילה 🔒 בשורת הכתובת ← התראות ← אפשר'}
             <br>ואז חזור לכאן.</div>`
        : perm === 'unsupported' ? `<div class="note">הדפדפן הזה לא תומך בהתראות.</div>`
        : (iOS && !standalone) ? `<div class="note">באייפון התראות עובדות רק אחרי שמוסיפים למסך הבית:<br>
             לוחצים על <b>שיתוף</b> ⬆︎ בסרגל התחתון → <b>הוספה למסך הבית</b> → פותחים את האפליקציה משם.</div>`
        : `<button id="notif" class="btn ${perm === 'granted' ? 'ghost' : 'primary'}">${perm === 'granted' ? 'התראות פעילות. לכיבוי לחץ כאן' : 'הפעל התראות על שינוי בשבצ״ק'}</button>`}

      <div class="sect">תזכורת לפני שמירה</div>
      <div class="note">מגיעה גם כשהאפליקציה סגורה.</div>
      <div id="remind" class="chips"></div>

      <div class="sect">מספר על האייקון</div>
      <div class="note">${'setAppBadge' in navigator
        ? 'המספר על אייקון האפליקציה אומר כמה שמירות יש לך ב-24 השעות הקרובות. מסתדר לבד, בלי לפתוח.'
        : 'המכשיר הזה לא תומך במספר על האייקון. באייפון צריך להוסיף את האפליקציה למסך הבית ולאשר התראות.'}</div>
      <div id="badgech" class="chips"></div>`;
    host.appendChild(box);

    const bc = $('#badgech');
    const off = !!LS.get('badgeOff', 0);
    [[0, 'מציג'], [1, 'בלי מספר']].forEach(([v, label]) => {
      const b = el('button', 'chip' + ((off ? 1 : 0) === v ? ' on' : ''), label);
      b.onclick = () => { LS.set('badgeOff', v); tellSW(); setBadge(); setNotif(); };
      bc.appendChild(b);
    });

    const rm = $('#remind');
    const cur = (S.roster && S.roster.remind) || 0;
    [[0, 'כבוי'], [5, '5 דק׳'], [15, '15 דק׳'], [30, '30 דק׳'], [60, 'שעה']].forEach(([v, label]) => {
      const b = el('button', 'chip' + (cur === v ? ' on' : ''), label);
      b.onclick = async () => {
        try {
          await api('/api/me', { sheet: S.sheet, remind: v });
          if (S.roster) S.roster.remind = v;
          if (v && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission();
            if (p === 'granted') await subscribePush();
            else toast('צריך לאשר התראות כדי שזה יעבוד');
          } else if (v) { await subscribePush(); }
          setNotif();
        } catch (e) { toast(e.message); }
      };
      rm.appendChild(b);
    });
    const nb = $('#notif');
    if (nb) nb.onclick = async () => {
      try {
        if (Notification.permission === 'granted') { await unsubscribePush(); toast('התראות כובו'); setNotif(); return; }
        const p = await Notification.requestPermission();
        if (p !== 'granted') { toast('לא ניתן אישור'); return; }
        await subscribePush(); toast('התראות פעילות'); setNotif();
      } catch (e) { toast(e.message); }
    };
  }

  function setSheets() {
    const host = subPage('השבצ״קים שלי', 'לחיצה על שם מחליפה לשבצ״ק הזה.', screenSettings);
    const box = el('div');
    box.innerHTML = `<div id="sheets"></div>
      <button id="addsheet" class="btn ghost">הצטרף לשבצ״ק נוסף</button>
      <button id="newsh2" class="btn ghost">צור שבצ״ק חדש כאן</button>`;
    host.appendChild(box);
    const sw = $('#sheets');
    S.sheets.forEach(x => {
      const row = el('div', 'crow');
      const stale = x.lastPoll ? Math.round((Date.now() - x.lastPoll) / 60000) : null;
      const info = el('span');
      info.innerHTML = `${esc(x.title || x.id)}${x.id === S.sheet ? ' •' : ''}
        <br><small class="dimmer">${x.lastError ? 'שגיאה' : (x.shiftCount || 0) + ' שיבוצים'}${stale !== null && stale > 30 ? ' · עודכן לפני ' + stale + ' דק׳' : ''}</small>`;
      info.style.cursor = 'pointer';
      info.onclick = () => { if (x.id !== S.sheet) switchSheet(x.id); };
      const out = el('button', 'link danger sm', 'עזוב');
      out.onclick = e => { e.stopPropagation(); leaveSheet(x); };
      row.appendChild(info); row.appendChild(out);
      sw.appendChild(row);
    });
    if (!S.sheets.length) sw.appendChild(el('div', 'none sm', 'אין עדיין'));
    $('#addsheet').onclick = () => screenAddSheet();
    $('#newsh2').onclick = screenNew;
  }

  function setMe() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const host = subPage('הפרטים שלי', '', screenSettings);
    const box = el('div');
    box.innerHTML = `
      <div class="card">
        <div class="crow"><span>שם</span><b>${esc(S.me || 'לא נבחר')}</b></div>
        <div class="crow"><span>קוד חשבון</span><b dir="ltr">${esc(S.account || 'לא ידוע')}</b></div>
        <div class="crow"><span>אזור זמן</span><b dir="ltr">${esc(TZ())}</b></div>
        <div class="crow"><span>גרסת שרת</span><b dir="ltr">${esc((S.cfg && S.cfg.version) || 'ישנה, צריך לפרוס מחדש')}</b></div>
      </div>

      <div class="sect">כינויים</div>
      <div class="note">אם מישהו מחפש אותך בכינוי שהאפליקציה לא מזהה, הוסף אותו כאן.</div>
      <div id="nicks" class="chips"></div>
      <div class="inline"><input id="nick" class="inp" placeholder="כינוי"><button id="addnick" class="btn ghost sm">הוסף</button></div>

      <div class="sect">מכשיר נוסף</div>
      <div class="note">פותחים את האפליקציה במכשיר השני ומזינים את הקוד. בלי להתחבר שוב.</div>
      <button id="xfer" class="btn ghost">צור קוד העברה</button>
      <div id="xout"></div>

      <div class="sect">התקנה</div>
      <button id="install" class="btn ghost">${standalone ? 'האפליקציה מותקנת ✓' : 'איך מוסיפים למסך הבית'}</button>

      <button id="out" class="link danger">התנתק ממכשיר זה</button>`;
    host.appendChild(box);

    const drawNicks = () => {
      const n = $('#nicks'); n.innerHTML = '';
      S.nicknames.forEach((x, i) => {
        const b = el('button', 'chip', esc(x) + ' ✕');
        b.onclick = async () => { S.nicknames.splice(i, 1); try { await api('/api/me', { sheet: S.sheet, nicknames: S.nicknames }); } catch (e) { } drawNicks(); };
        n.appendChild(b);
      });
      if (!S.nicknames.length) n.appendChild(el('span', 'none sm', 'אין כינויים'));
    };
    drawNicks();
    $('#addnick').onclick = async () => {
      const x = $('#nick').value.trim(); if (!x) return;
      S.nicknames.push(x); $('#nick').value = '';
      applyNicknames(); drawNicks();
      try { await api('/api/me', { sheet: S.sheet, nicknames: S.nicknames }); } catch (e) { }
    };
    $('#install').onclick = screenInstall;
    $('#xfer').onclick = async () => {
      try {
        const r = await api('/api/account/transfer');
        $('#xout').innerHTML = `<div class="code" dir="ltr">${esc(r.code)}</div><div class="note">תקף ל-15 דקות</div>`;
      } catch (e) { toast(e.message); }
    };
    $('#out').onclick = async () => {
      try { await api('/api/logout', {}); } catch (e) { }
      try { Object.keys(localStorage).filter(k => k.indexOf('sh.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { }
      location.reload();
    };
  }

  function setTools() {
    menuPage({
      title: 'כלים',
      rows: [
        { id: 'leader', icon: '🏅', label: 'טבלת שעות', note: 'מי עשה הכי הרבה', fn: screenLeader },
        { id: 'builder', icon: '📐', label: 'בנה טבלה להעתקה', note: 'טבלה מוכנה להדבקה ל-Sheets', fn: screenBuilder },
        { id: 'diag', icon: '🔎', label: 'אבחון', note: 'מה בדיוק נקרא מהשבצ״ק, ומה לא', fn: screenDiag },
      ],
      back: { id: 'backsub', label: 'חזרה', fn: screenSettings },
    });
  }

  /* Leaving is the one destructive thing a member can do to themselves, so it
     asks once — and asks harder when the server says they're the last one out
     and the שבצ״ק would go with them. */
  async function leaveSheet(x) {
    const name = x.title || 'השבצ״ק';
    if (!confirm('לצאת מ' + name + '?\n\nהשיבוצים שלך יפסיקו להופיע ולא תקבל יותר התראות עליו. אפשר לחזור עם קישור הזמנה.')) return;
    const done = async r => {
      LS.del('me:' + x.id);
      if (S.sheet === x.id) { S.sheet = null; LS.del('sheet'); S.roster = null; S.me = null; }
      await loadSheets();
      if (S.sheet) { try { await loadRoster(); } catch (e) { } }
      toast(r.deleted ? name + ' נמחק' : r.handover ? 'יצאת · הבעלות עברה ל' + r.handover : 'יצאת מ' + name);
      S.sheets.length ? setSheets() : screenAddSheet();
    };
    try { done(await api('/api/sheets/leave', { id: x.id })); }
    catch (e) {
      if (!e.needConfirm) return toast(e.message);
      if (!confirm(e.message + '\n\nלהמשיך?')) return;
      try { done(await api('/api/sheets/leave', { id: x.id, confirm: true })); }
      catch (e2) { toast(e2.message); }
    }
  }

  /* Pick a lot of people out of a long roster. A modal with a search box and a
     running count, because פיקוד is forty names out of a hundred and fourteen
     and doing that with a scrolling list of checkboxes is a punishment. */
  function pickPeople(title, names, chosen, onDone) {
    const cur = new Set((chosen || []).map(nk));
    const wrap = el('div', 'pickwrap');
    const sheet = el('div', 'picksheet');
    sheet.innerHTML = `<div class="sect">${esc(title)}</div>
      <input id="ppq" class="inp" placeholder="חפש שם">
      <div class="inline" style="margin-top:8px">
        <button id="ppall" class="btn ghost sm">בחר את כל התוצאות</button>
        <button id="ppnone" class="btn ghost sm">נקה הכל</button>
        <span class="note" id="ppn"></span>
      </div>
      <div id="pplist" style="margin-top:8px"></div>
      <button id="ppdone" class="btn primary">אישור</button>`;
    wrap.appendChild(sheet); document.body.appendChild(wrap);

    let shown = names.slice();
    const draw = () => {
      const q = ($('#ppq').value || '').trim();
      shown = !q ? names.slice()
        : (M.rankNames(q, names, 60, null).map(h => h.name).length
            ? M.rankNames(q, names, 60, null).map(h => h.name)
            : names.filter(n => n.indexOf(q) >= 0));
      $('#ppn').textContent = 'נבחרו ' + cur.size;
      const box = $('#pplist');
      box.innerHTML = '';
      shown.slice(0, 200).forEach(n => {
        const b = el('button', 'res' + (cur.has(nk(n)) ? ' exact' : ''));
        b.innerHTML = `<span class="rn">${esc(n)}</span><span class="rc">${cur.has(nk(n)) ? '✓' : ''}</span>`;
        b.onclick = () => { cur.has(nk(n)) ? cur.delete(nk(n)) : cur.add(nk(n)); draw(); };
        box.appendChild(b);
      });
      if (!shown.length) box.appendChild(el('div', 'none sm', 'אין תוצאות'));
    };
    $('#ppq').oninput = draw;
    $('#ppall').onclick = () => { shown.forEach(n => cur.add(nk(n))); draw(); };
    $('#ppnone').onclick = () => { cur.clear(); draw(); };
    const finish = () => { wrap.remove(); onDone(names.filter(n => cur.has(nk(n)))); };
    $('#ppdone').onclick = finish;
    wrap.onclick = e => { if (e.target === wrap) finish(); };
    draw();
    setTimeout(() => { try { $('#ppq').focus(); } catch (e) { } }, 30);
  }

  /* One editor, three doors into it: Settings, the roster editor, and the
     wizard. A textarea rather than a row-builder because the list always
     arrives as a block pasted out of WhatsApp. */
  async function contactsEditor(host, sheetId) {
    if (!host) return;
    let cur = { contacts: [], admin: false };
    try { cur = await api('/api/sheets/contacts?sheet=' + encodeURIComponent(sheetId)); } catch (e) { }
    const draw = () => {
      host.innerHTML = `<div class="note">מי שעומד בשמירה רואה את הרשימה הזו במסך "מי בשמירה עכשיו", ולוחץ כדי להתקשר.</div>
        ${cur.admin ? `<textarea id="ctxt" class="inp ta" placeholder="תומר כהן, מ״פ, 050-1234567&#10;אלון מזרחי, סמ״פ, 052-1112222"></textarea>
        <div class="note">שורה לכל אחד: שם, תפקיד, טלפון. הסדר לא משנה, המספר מזוהה לבד.</div>
        <button id="csave" class="btn ghost sm">שמור אנשי קשר</button>` : ''}
        <div id="cprev"></div>`;
      const prev = $('#cprev');
      if (!cur.contacts.length) prev.appendChild(el('div', 'none sm', 'אין עדיין'));
      else drawContactsInto(prev, cur.contacts);
      if (!cur.admin) return;
      $('#ctxt').value = NA().contactsToText(cur.contacts);
      $('#csave').onclick = async () => {
        const contacts = NA().sanitiseContacts(NA().parseContacts($('#ctxt').value));
        $('#csave').textContent = 'שומר…';
        try {
          const r = await api('/api/sheets/contacts?sheet=' + encodeURIComponent(sheetId), { contacts });
          cur.contacts = r.contacts;
          if (S.roster && sheetId === S.sheet) S.roster.contacts = r.contacts;
          toast(r.contacts.length ? 'נשמרו ' + r.contacts.length + ' אנשי קשר' : 'הרשימה רוקנה');
          draw();
        } catch (e) { $('#csave').textContent = 'שמור אנשי קשר'; toast(e.message); }
      };
    };
    draw();
  }

  function drawContactsInto(host, list) {
    const card = el('div', 'card');
    list.forEach(x => {
      const row = el('div', 'crow');
      row.innerHTML = `<span>${esc(x.name || '')}${x.role ? `<br><small class="dimmer">${esc(x.role)}</small>` : ''}</span>
        <b dir="ltr">${esc(x.phone || '—')}</b>`;
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  function applyNicknames() {
    if (!S.roster || !S.me) return;
    S.roster.aliases = S.roster.aliases || {};
    const cur = S.roster.aliases[S.me] || [S.me];
    S.roster.aliases[S.me] = [...new Set([...cur, ...S.nicknames])];
  }

  /* ---------- invites ---------- */
  let pendingInvite = null;
  async function redeemInvite(code) {
    try {
      const r = await api('/api/sheets/join', { code });
      pendingInvite = null;
      history.replaceState(null, '', location.pathname);
      await loadSheets();
      S.sheet = r.id; LS.set('sheet', r.id);
      await loadRoster();
      toast('הצטרפת ל' + (r.title || 'שבצ״ק'));
      route();
    } catch (e) { pendingInvite = null; screenAddSheet(e.message); }
  }

  function screenAddSheet(err) {
    const v = $('#view'); v.innerHTML = '';
    const first = !S.sheets.length;
    const joinBlock = `
      <div class="sect">${first ? 'קיבלת קישור או שיש שבצ״ק ב-Google Sheets' : 'הצטרף לשבצ״ק קיים'}</div>
      <div class="note">הדבק את הקישור לשבצ״ק. אם הוא כבר במערכת תישלח בקשה למי שחיבר אותו, ואתה בפנים ברגע שהוא מאשר.</div>
      <input id="link" class="inp" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/...">
      <button id="add" class="btn ${first ? 'ghost' : 'primary'}">המשך</button>
      <details class="help"><summary>יש לי קוד הזמנה</summary>
        <div class="inline"><input id="code" class="inp" dir="ltr" placeholder="XXXXXXXX" autocapitalize="characters"><button id="join" class="btn ghost sm">הצטרף</button></div>
      </details>
      <div class="note" style="margin-top:14px">אם השבצ״ק עוד לא במערכת, בחר אותו מ-Google Drive. האפליקציה מקבלת גישה לקובץ הזה בלבד.</div>
      <button id="pick" class="btn ghost">בחר מ-Google Drive</button>`;
    /* Most units don't keep a שבצ"ק in Sheets at all, so for somebody with
       nothing yet the honest first offer is "build one", not "paste a link". */
    const makeBlock = `
      <div class="sect">${first ? 'אין לך שבצ״ק?' : 'שבצ״ק חדש'}</div>
      <div class="note">בנה אותו כאן. ממלאים שמות ועמדות, האפליקציה מסדרת את המשמרות, ואחר כך מזיזים אנשים ביד. בלי Google Sheets בכלל.</div>
      <button id="newsh" class="btn ${first ? 'primary' : 'ghost'}">צור שבצ״ק חדש</button>`;

    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">${first ? 'בוא נתחיל' : 'הוסף שבצ״ק'}</div>
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      ${first ? makeBlock + joinBlock : joinBlock + makeBlock}
      ${first ? '' : '<button id="back" class="btn ghost">חזרה</button>'}`;
    v.appendChild(c);
    const jb = $('#join'); if (jb) jb.onclick = () => { const x = $('#code').value.trim(); if (x) redeemInvite(x); };
    $('#add').onclick = () => addSheet($('#link').value.trim());
    $('#newsh').onclick = screenNew;
    $('#pick').onclick = pickSheet;
    if (!first) $('#back').onclick = route;
  }

  async function addSheet(link) {
    if (!link) return;
    try {
      const r = await api('/api/sheets/add', { url: link });
      await afterAdd(r);
    } catch (e) {
      // an unknown sheet can't be authorised from a URL any more — it has to be
      // chosen in the Picker, which is what grants access to that one file
      if (e.needPicker || /Google Drive/.test(e.message)) pickSheet();
      else screenAddSheet(e.message);
    }
  }
  function screenOffline(err) {
    const cachedSheet = LS.get('sheet', null);
    const cached = cachedSheet ? LS.get('roster:' + cachedSheet, null) : null;
    const who = S.me || (cached && cached.me);
    if (cached && who) {                             // show the last known answer rather than nothing
      S.me = who;
      S.sheet = cachedSheet; S.roster = cached; S.offline = true;
      S.sheets = S.sheets.length ? S.sheets : [{ id: cachedSheet, title: cached.title || '' }];
      screenMain();
      toast('אין חיבור, מוצג המידע האחרון שנשמר');
      return;
    }
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">אין חיבור</div>
      <p class="sub">אתה עדיין מחובר, פשוט אי אפשר להגיע לשרת כרגע.</p>
      <div class="err">${esc(String(err && err.message || err))}</div>
      <button id="again" class="btn primary">נסה שוב</button>`;
    v.appendChild(c);
    $('#again').onclick = () => boot();
  }

  function screenPending(r) {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">הבקשה נשלחה</div>
      <p class="sub">ביקשת להצטרף ל<b>${esc(r.title || 'שבצ״ק')}</b>. מי שחיבר אותו קיבל התראה, וברגע שיאשר האפליקציה תיפתח לבד.</p>
      <div class="card"><div class="crow"><span>סטטוס</span><b>ממתין לאישור</b></div></div>
      <button id="recheck" class="btn primary">בדוק שוב</button>
      <button id="other" class="btn ghost">שבצ״ק אחר</button>`;
    v.appendChild(c);
    $('#recheck').onclick = async () => {
      $('#recheck').textContent = 'בודק…';
      await loadSheets();
      if (S.sheets.length) { await loadRoster(); route(); }
      else { $('#recheck').textContent = 'עדיין ממתין. בדוק שוב'; }
    };
    $('#other').onclick = () => screenAddSheet();
    clearInterval(pendTimer);
    pendTimer = setInterval(async () => {
      try { await loadSheets(); } catch (e) { return; }
      if (S.sheets.length) { clearInterval(pendTimer); await loadRoster(); route(); }
    }, 20000);
  }
  let pendTimer = null;

  async function afterAdd(r) {
    if (r.pending) return screenPending(r);
    clearInterval(pendTimer);
    await loadSheets();
    S.sheet = r.id; LS.set('sheet', r.id);
    await loadRoster();
    route();
  }

  /* ---------- staying current ----------
     A web app has no store update: whatever the worker serves is what people
     run. But an installed app can stay open for days, so it has to notice that
     the server moved on rather than quietly running last week's build. */
  let newBuild = null;
  async function checkBuild() {
    if (!window.__BUILD) return;
    try {
      const r = await fetch('/build.txt', { cache: 'no-store' });
      if (!r.ok) return;
      const b = (await r.text()).trim();
      if (b && b !== window.__BUILD) { newBuild = b; showUpdateBar(); }
    } catch (e) { }
  }
  function showUpdateBar() {
    if (document.getElementById('updbar')) return;
    const b = el('div', 'updbar');
    b.id = 'updbar';
    b.innerHTML = 'יש גרסה חדשה <button id="updnow">רענן</button>';
    document.body.appendChild(b);
    $('#updnow').onclick = doUpdate;
  }
  async function doUpdate() {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update().catch(() => { })));
    } catch (e) { }
    location.reload();
  }

  /* ---------- build a שבצ"ק from names + posts ---------- */
  const B = { people: '', posts: 'שער ראשי\nסיור x2\nעמדה צפונית', days: 4, slotHours: 4, slotStart: '02:00', minRest: 2, out: null };

  function screenBuilder() {
    const v = $('#view'); v.innerHTML = '';

    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">בנה שבצ״ק</div>
      <p class="sub">שמות ועמדות פנימה, שבצ״ק הוגן החוצה. מעתיקים ומדביקים ישר ל-Sheets.</p>

      <div class="lblrow"><label class="lbl">שמות, אחד בכל שורה</label>
        ${(S.roster && S.roster.names && S.roster.names.length) ? '<button id="bfill" class="link sm">מלא מהשבצ״ק הקיים</button>' : ''}</div>
      <textarea id="bp" class="inp ta big2" placeholder="תומר כהן&#10;יוסי לוי&#10;..."></textarea>

      <label class="lbl">עמדות, אחת בכל שורה. "סיור x2" = שני אנשים בעמדה</label>
      <textarea id="bs" class="inp ta"></textarea>

      <div class="grid2">
        <div><label class="lbl">ימים</label><input id="bd" class="inp" type="number" min="1" max="30" value="${B.days}"></div>
        <div><label class="lbl">אורך משמרת</label>
          <select id="bh" class="sel wide">
            ${[2, 3, 4, 6, 8, 12].map(h => `<option value="${h}"${B.slotHours === h ? ' selected' : ''}>${h} שעות</option>`).join('')}
          </select></div>
        <div><label class="lbl">מתחיל בשעה</label><input id="bt" class="inp" type="time" value="${B.slotStart}"></div>
        <div><label class="lbl">מנוחה (משמרות)</label><input id="br" class="inp" type="number" min="0" max="10" value="${B.minRest}"></div>
      </div>

      <button id="bgo" class="btn primary">בנה</button>
      <div id="bout"></div>
      <button id="back4" class="btn ghost">חזרה</button>`;
    v.appendChild(c);
    $('#bp').value = B.people; $('#bs').value = B.posts;
    const bf = $('#bfill');
    if (bf) bf.onclick = () => { $('#bp').value = S.roster.names.join('\n'); B.people = $('#bp').value; };
    $('#back4').onclick = route;
    $('#bgo').onclick = () => {
      B.people = $('#bp').value; B.posts = $('#bs').value;
      B.days = +$('#bd').value || 1; B.slotHours = +$('#bh').value || 4;
      B.slotStart = $('#bt').value || '02:00'; B.minRest = +$('#br').value || 0;
      const posts = B.posts.split('\n').map(x => x.trim()).filter(Boolean).map(x => {
        const m = x.match(/^(.*?)\s*[x*×]\s*(\d+)$/);
        return m ? { name: m[1].trim(), per: +m[2] } : { name: x, per: 1 };
      });
      const start = new Date(); start.setHours(0, 0, 0, 0);
      B.out = SHGen.build({
        people: B.people.split('\n'), posts, start, days: B.days,
        slots: SHGen.slotsEvery(B.slotStart, B.slotHours), minRest: B.minRest,
      });
      drawOut();
    };
    if (B.out) drawOut();

    function drawOut() {
      const o = B.out, box = $('#bout');
      if (!o || !o.rows.length) { box.innerHTML = '<div class="err">' + esc((o && o.warnings[0]) || 'חסר מידע') + '</div>'; return; }
      const f = o.fairness;
      box.innerHTML = `
        <div class="card">
          <div class="crow"><span>שיבוצים</span><b>${f.total}</b></div>
          <div class="crow"><span>אנשים בשיבוץ</span><b>${f.used} מתוך ${f.people}</b></div>
          <div class="crow"><span>לכל אחד</span><b>${(() => {
            const c = o.stats.filter(x => x.count).map(x => x.count);
            const lo = Math.min.apply(null, c), hi = Math.max.apply(null, c);
            return lo === hi ? lo : lo + '–' + hi;
          })()}</b></div>
          <div class="crow"><span>לילות לכל אחד</span><b>${f.nightMin === f.nightMax ? f.nightMin : f.nightMin + '–' + f.nightMax}</b></div>
        </div>
        ${o.warnings.length ? '<div class="warnbox">' + o.warnings.map(esc).join('<br>') + '</div>' : ''}
        <div class="inline" style="margin-top:10px">
          <button id="bcopy" class="btn ghost sm">העתק ל-Sheets</button>
          <button id="bcsv" class="btn ghost sm">הורד CSV</button>
        </div>
        <div class="sect">תצוגה מקדימה</div>
        <div class="tablewrap"><table class="gen">${o.rows.map((r, i) =>
          '<tr>' + r.map(cll => `<${i ? 'td' : 'th'}>${esc(cll)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('')}</table></div>
        <div class="sect">כמה לכל אחד</div>
        <div class="card">${o.stats.map(x =>
          `<div class="crow"><span>${esc(x.name)}</span><b>${x.count}${x.night ? ' · ' + x.night + ' לילה' : ''}</b></div>`).join('')}</div>`;
      $('#bcopy').onclick = async () => {
        const tsv = SHGen.toTSV(o.rows);
        try { await navigator.clipboard.writeText(tsv); toast('הועתק. הדבק בתא הראשון ב-Sheets'); }
        catch (e) {
          const t = document.createElement('textarea');
          t.value = tsv; document.body.appendChild(t); t.select();
          document.execCommand('copy'); t.remove(); toast('הועתק');
        }
      };
      $('#bcsv').onclick = () => {
        const blob = new Blob(['\ufeff' + SHGen.toCSV(o.rows)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'shavtzak.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      };
    }
  }

  /* ============================================================
     שבצ"ק שנבנה כאן — wizard + editor

     Half the units this ends up in don't keep their roster in Sheets at all,
     so the app has to be able to own one. The wizard produces a first draft;
     the editor is where it actually lives, because a שבצ"ק is never right the
     first time — somebody swaps, somebody goes home, somebody gets גימלים.
     ============================================================ */
  const NA = () => globalThis.SHNative;
  const isNative = id => {
    const x = S.sheets.find(s => s.id === (id || S.sheet));
    return !!(x && x.kind === 'native');
  };
  function todayYMD() { const p = zparts(new Date()); return p.y + '-' + pad(p.mo) + '-' + pad(p.d); }

  const NW = {
    title: '', people: '', posts: 'שער ראשי\nסיור x2\nעמדה צפונית',
    start: '', days: 7, slotHours: 4, slotStart: '02:00', minRest: 1, fill: true,
  };
  // the demo build seeds the wizard so there is something to press "create" on
  if (globalThis.__prefill) Object.assign(NW, globalThis.__prefill);
  /* "סיור x2" → two people every shift.  "מטבח @07:00-23:59" → one block a day
     that everybody on it shares, which is how כוננויות and מטבח actually work. */
  function parsePostLines(text) {
    return String(text || '').split('\n').map(x => x.trim()).filter(Boolean).map(line => {
      let name = line, per = 1, mode = 'slot', start = '07:00', end = '23:59';
      const d = name.match(/^(.*?)\s*@\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*$/);
      if (d) { name = d[1].trim(); mode = 'daily'; start = d[2]; end = d[3]; }
      const m = name.match(/^(.*?)\s*[x*×]\s*(\d+)$/);
      if (m) { name = m[1].trim(); per = Math.max(1, Math.min(+m[2], 20)); }
      return name ? { name, per, mode, start, end } : null;
    }).filter(Boolean);
  }

  function screenNew() {
    const v = $('#view'); v.innerHTML = '';
    if (!NW.start) NW.start = todayYMD();
    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">שבצ״ק חדש</div>
      <p class="sub">בלי Google Sheets. השבצ״ק נשמר כאן, כל מי שתצרף רואה אותו מיד ומקבל התראה בכל פעם שמשהו בו זז.</p>

      <label class="lbl">שם השבצ״ק</label>
      <input id="ntitle" class="inp" placeholder="שבצ״ק פלוגה ב׳" value="${esc(NW.title)}">

      <div class="lblrow"><label class="lbl">שמות, אחד בכל שורה</label>
        ${(S.roster && S.roster.names && S.roster.names.length) ? '<button id="nfill" class="link sm">מלא מהשבצ״ק הנוכחי</button>' : ''}</div>
      <textarea id="npeople" class="inp ta big2" placeholder="תומר כהן&#10;יוסי לוי&#10;..."></textarea>

      <label class="lbl">עמדות, אחת בכל שורה</label>
      <textarea id="nposts" class="inp ta"></textarea>
      <div class="note">‎"סיור x2" = שני אנשים יחד. ‎"מטבח @07:00-23:59" = משבצת יומית אחת שכולם בה ביחד, בלי קשר לשעות המשמרות.<br>
        כוננות, עמדה שמתאיישת ממי שיורד משמירה, והמשך ליום ריק. את אלה מגדירים אחרי היצירה, בלשונית <b>עמדות</b>.</div>

      <div class="grid2">
        <div><label class="lbl">מתחיל בתאריך</label><input id="nstart" class="inp" type="date" value="${esc(NW.start)}"></div>
        <div><label class="lbl">כמה ימים</label><input id="ndays" class="inp" type="number" min="1" max="120" value="${NW.days}"></div>
        <div><label class="lbl">אורך משמרת</label>
          <select id="nhours" class="sel wide">
            ${[2, 3, 4, 6, 8, 12].map(h => `<option value="${h}"${NW.slotHours === h ? ' selected' : ''}>${h} שעות</option>`).join('')}
          </select></div>
        <div><label class="lbl">משמרת ראשונה בשעה</label><input id="nsstart" class="inp" type="time" value="${esc(NW.slotStart)}"></div>
        <div><label class="lbl">שיבוץ</label>
          <select id="nfillmode" class="sel wide">
            <option value="1">שבץ אוטומטית</option>
            <option value="0">השאר ריק, אשבץ בעצמי</option>
          </select></div>
      </div>

      <label class="lbl">מפקדים וקצינים (לא חובה)</label>
      <textarea id="ncontacts" class="inp ta" placeholder="תומר כהן, מ״פ, 050-1234567&#10;אלון מזרחי, סמ״פ, 052-1112222"></textarea>
      <div class="note">שורה לכל אחד: שם, תפקיד, טלפון. הרשימה תופיע לכולם במסך "מי בשמירה עכשיו", עם לחיצה להתקשרות.</div>

      <div id="nerr"></div>
      <button id="ngo" class="btn primary">צור שבצ״ק</button>
      <button id="nback" class="btn ghost">חזרה</button>`;
    v.appendChild(c);
    $('#npeople').value = NW.people; $('#nposts').value = NW.posts;
    $('#nfillmode').value = NW.fill ? '1' : '0';
    const nf = $('#nfill');
    if (nf) nf.onclick = () => { $('#npeople').value = S.roster.names.join('\n'); };
    $('#nback').onclick = () => (S.sheets.length ? route() : screenAddSheet());

    $('#ngo').onclick = async () => {
      NW.title = $('#ntitle').value.trim(); NW.people = $('#npeople').value; NW.posts = $('#nposts').value;
      NW.start = $('#nstart').value || todayYMD(); NW.days = +$('#ndays').value || 1;
      NW.slotHours = +$('#nhours').value || 4; NW.slotStart = $('#nsstart').value || '02:00';
      NW.fill = $('#nfillmode').value === '1';
      const people = NW.people.split('\n').map(x => x.trim()).filter(Boolean);
      const posts = parsePostLines(NW.posts);
      const err = m => { $('#nerr').innerHTML = `<div class="err">${esc(m)}</div>`; };
      if (!NW.title) return err('צריך שם לשבצ״ק');
      if (!people.length) return err('צריך לפחות שם אחד');
      if (!posts.length) return err('צריך לפחות עמדה אחת');

      let doc = NA().sanitise({
        title: NW.title, people, posts,
        days: NA().daysFrom(NW.start, NW.days),
        slots: SHGen.slotsEvery(NW.slotStart, NW.slotHours),
      });
      let warn = [];
      if (NW.fill) { const r = NA().autofill(doc); doc = r.doc; warn = r.warnings || []; }

      $('#ngo').textContent = 'יוצר…'; $('#ngo').disabled = true;
      try {
        const r = await api('/api/native/create', { doc });
        const ctc = NA().sanitiseContacts(NA().parseContacts($('#ncontacts').value));
        if (ctc.length) { try { await api('/api/sheets/contacts?sheet=' + encodeURIComponent(r.id), { contacts: ctc }); } catch (e) { } }
        await loadSheets();
        S.sheet = r.id; LS.set('sheet', r.id);
        await loadRoster();
        if (warn.length) toast(warn[0]);
        screenEdit();
      } catch (e) {
        $('#ngo').textContent = 'צור שבצ״ק'; $('#ngo').disabled = false;
        err(e.message);
      }
    };
  }

  /* ---------------- the editor ---------------- */
  const E = { id: null, doc: null, rev: 0, admin: false, tab: 'grid', day: 0, sel: null, undo: [], dirty: false, minRest: 1 };

  async function screenEdit(id) {
    const sheet = id || S.sheet;
    const v = $('#view'); v.innerHTML = '';
    v.appendChild(el('div', 'none', 'טוען…'));
    let r;
    try { r = await api('/api/native?sheet=' + encodeURIComponent(sheet)); }
    catch (e) { v.innerHTML = ''; v.appendChild(el('div', 'err', e.message)); return; }
    E.id = sheet; E.doc = NA().sanitise(r.doc); E.rev = E.doc.rev || 0;
    E.admin = !!r.admin; E.sel = null; E.undo = []; E.dirty = false;
    E.day = Math.min(E.day, Math.max(0, E.doc.days.length - 1));
    drawEdit();
  }

  const snapshot = () => JSON.parse(JSON.stringify({ cells: E.doc.cells, people: E.doc.people, posts: E.doc.posts, days: E.doc.days, slots: E.doc.slots, unavailable: E.doc.unavailable, title: E.doc.title }));
  function mutate(fn) {
    E.undo.push(snapshot());
    if (E.undo.length > 40) E.undo.shift();
    fn();
    E.doc = NA().applyFrom(NA().sanitise(E.doc));   // fed columns follow the change
    E.dirty = true;
    drawEdit();
  }
  function undo() {
    const s = E.undo.pop(); if (!s) return;
    Object.assign(E.doc, s);
    E.doc = NA().sanitise(E.doc);
    E.sel = null; E.dirty = true; drawEdit();
  }

  function drawEdit() {
    const v = $('#view'); v.innerHTML = '';
    const D = E.doc, Nv = NA();
    const aud = Nv.audit(D, { minRest: E.minRest });
    E.aud = aud;

    const wrap = el('div');
    const bar = el('div', 'edbar');
    bar.innerHTML = `<button class="icon" id="eback" title="חזרה">✕</button>
      <div class="grow">${esc(D.title)}</div>
      ${E.undo.length ? '<button class="icon" id="eundo" title="בטל">↺</button>' : ''}`;
    wrap.appendChild(bar);

    const tabs = el('div', 'tabs');
    const TB = [['grid', 'שיבוץ'], ['people', 'אנשים'], ['posts', 'עמדות'],
                ['contacts', 'אנשי קשר'], ['issues', 'בעיות' + (aud.issues.length ? ' · ' + aud.issues.length : '')]];
    tabs.innerHTML = TB.map(([k, l]) => `<button class="tb${E.tab === k ? ' on' : ''}" data-k="${k}">${esc(l)}</button>`).join('');
    wrap.appendChild(tabs);

    const body = el('div');
    wrap.appendChild(body);
    $('#view').appendChild(wrap);

    tabs.querySelectorAll('.tb').forEach(b => b.onclick = () => { E.tab = b.dataset.k; E.sel = null; drawEdit(); });
    $('#eback').onclick = () => {
      if (E.dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return;
      route();
    };
    const ub = $('#eundo'); if (ub) ub.onclick = undo;

    if (E.tab === 'grid') drawGrid(body, aud);
    else if (E.tab === 'people') drawPeople(body, aud);
    else if (E.tab === 'posts') drawPosts(body);
    else if (E.tab === 'contacts') contactsEditor(body, E.id);
    else drawIssues(body, aud);

    if (E.admin) {
      const save = el('div', 'savebar');
      save.innerHTML = `<button id="esave" class="btn primary" ${E.dirty ? '' : 'disabled style="opacity:.5"'}>${E.dirty ? 'שמור ופרסם' : 'שמור'}</button>`;
      wrap.appendChild(save);
      $('#esave').onclick = saveEdit;
    } else {
      wrap.appendChild(el('div', 'note', 'רק מנהל יכול לערוך את השבצ״ק הזה.'));
    }
  }

  async function saveEdit() {
    const b = $('#esave'); b.textContent = 'שומר…'; b.disabled = true;
    try {
      const r = await api('/api/native?sheet=' + encodeURIComponent(E.id), { sheet: E.id, rev: E.rev, doc: E.doc });
      E.rev = r.rev; E.dirty = false; E.undo = [];
      await loadSheets();
      try { await loadRoster(); } catch (e) { }
      toast(r.changed ? 'נשמר · ' + r.changed + ' שינויים נשלחו' : 'נשמר');
      drawEdit();
    } catch (e) {
      b.textContent = 'שמור ופרסם'; b.disabled = false;
      toast(e.message);
    }
  }

  /* ---- the grid: one day at a time, tap to select, tap again to swap ---- */
  function drawGrid(body, aud) {
    const D = E.doc, Nv = NA();
    if (!D.days.length) { body.appendChild(el('div', 'none', 'אין ימים. הוסף ימים בלשונית עמדות.')); return; }
    E.day = Math.max(0, Math.min(E.day, D.days.length - 1));
    const ymd = D.days[E.day];

    const badDays = new Set(aud.issues.filter(i => i.kind !== 'hole').map(i => i.ymd));
    const strip = el('div', 'daystrip');
    strip.innerHTML = D.days.map((d, i) =>
      `<button class="dchip${i === E.day ? ' on' : ''}${badDays.has(d) ? ' bad' : ''}" data-i="${i}">${esc(Nv.dayLabel(d))}</button>`).join('');
    body.appendChild(strip);
    strip.querySelectorAll('.dchip').forEach(b => b.onclick = () => { E.day = +b.dataset.i; E.sel = null; drawEdit(); });

    const slotted = D.posts.filter(p => p.mode === 'slot');
    const daily = D.posts.filter(p => p.mode === 'daily');
    const holes = new Set(aud.issues.filter(i => i.kind === 'hole' && i.ymd === ymd).map(i => i.si + '|' + i.post));
    const flagged = new Set(aud.issues.filter(i => i.ymd === ymd && i.name && i.kind !== 'hole').map(i => i.si + '|' + i.name));

    const tw = el('div', 'tablewrap');
    const t = el('table', 'ed');
    const nightRow = s => { const h = +String(s.start).split(':')[0]; return h >= 22 || h < 6; };

    let html = '<tr><th>שעה</th>' + slotted.map(p => `<th>${esc(p.name)}${p.per > 1 ? ' ×' + p.per : ''}</th>`).join('') + '</tr>';
    D.slots.forEach((slot, si) => {
      html += `<tr class="${nightRow(slot) ? 'night' : ''}"><td class="hh">${esc(slot.start)}<br>${esc(slot.end)}</td>` +
        slotted.map(p => `<td data-si="${si}" data-post="${esc(p.name)}"></td>`).join('') + '</tr>';
    });
    t.innerHTML = html;
    tw.appendChild(t); body.appendChild(tw);

    const fillCell = (td, si, post) => {
      const names = D.cells[Nv.cellKey(ymd, si, post.name)] || [];
      const box = el('div', 'pc');
      names.forEach(n => {
        // a fed column is the rule's output; editing it by hand would be undone
        const b = el(post.from ? 'span' : 'button',
          'nm' + (post.from ? ' auto' : '') + (isSel(ymd, si, post.name, n) ? ' sel' : '') +
          (flagged.has(si + '|' + n) ? ' warn' : '') + (S.me && n === S.me ? ' me' : ''), esc(n));
        if (!post.from) b.onclick = () => tapName(ymd, si, post.name, n);
        box.appendChild(b);
      });
      if (post.from) {
        if (!names.length) box.appendChild(el('span', 'add auto', '—'));
      } else {
        const want = post.mode === 'daily' ? Infinity : post.per;
        if (names.length < want || post.mode === 'daily') {
          const a = el('button', 'add' + (holes.has(si + '|' + post.name) ? ' want' : ''), E.sel ? 'כאן' : '+');
          a.onclick = () => tapEmpty(ymd, si, post.name);
          box.appendChild(a);
        }
      }
      td.innerHTML = ''; td.appendChild(box);
    };

    t.querySelectorAll('td[data-post]').forEach(td => {
      const post = slotted.find(p => p.name === td.dataset.post);
      if (post) fillCell(td, +td.dataset.si, post);
    });

    /* Not one block a day: כרמל א turns over daily and often twice in a day, at
       whatever hour was decided that morning. Each block owns its hours and its
       people, and a day can be cut wherever it needs cutting. */
    if (daily.length) {
      body.appendChild(el('div', 'sect', 'כל היום'));
      daily.forEach(post => {
        const segs = Nv.segsFor(D, ymd, post);
        const box = el('div', 'dpost');
        box.innerHTML = `<div class="phead"><b>${esc(post.name)}</b>${post.from
          ? '<span class="dimmer">אוטומטי</span>'
          : `<button class="link sm dsplit">פצל את היום</button>`}</div>`;
        segs.forEach((seg, i) => {
          const row = el('div', 'dseg');
          row.innerHTML = `<span class="times2">
              <input class="tin s1" type="time" value="${esc(seg.start)}"${post.from ? ' disabled' : ''}>
              <input class="tin s2" type="time" value="${esc(seg.end)}"${post.from ? ' disabled' : ''}>
            </span>
            <span class="dcell"></span>
            ${(!post.from && segs.length > 1) ? '<button class="link danger sm dcut">מחק</button>' : ''}`;
          fillCell(row.querySelector('.dcell'), Nv.segSlot(i), post);
          /* Blocks meet — moving a changeover moves both sides of it. Editing
             one end and leaving a two-hour hole in the day is never what
             anybody meant by "they switch at eight". */
          const write = which => {
            const v1 = row.querySelector('.s1').value, v2 = row.querySelector('.s2').value;
            const list = segs.map(x => ({ start: x.start, end: x.end }));
            list[i] = { start: v1, end: v2 };
            if (which === 'end' && list[i + 1]) list[i + 1].start = v2;
            if (which === 'start' && list[i - 1]) list[i - 1].end = v1;
            mutate(() => { E.doc.segs = Object.assign({}, E.doc.segs, { [Nv.segKey(ymd, post.name)]: list }); });
          };
          const a1 = row.querySelector('.s1'), a2 = row.querySelector('.s2');
          if (!post.from) { a1.onchange = () => write('start'); a2.onchange = () => write('end'); }
          const cut = row.querySelector('.dcut');
          if (cut) cut.onclick = () => mutate(() => {
            const list = segs.filter((_, j) => j !== i);
            const cells = Object.assign({}, E.doc.cells);
            // shift the people of every later block down one index
            segs.forEach((_, j) => { if (j >= i) delete cells[Nv.cellKey(ymd, Nv.segSlot(j), post.name)]; });
            segs.forEach((_, j) => {
              if (j <= i) return;
              const v = D.cells[Nv.cellKey(ymd, Nv.segSlot(j), post.name)];
              if (v) cells[Nv.cellKey(ymd, Nv.segSlot(j - 1), post.name)] = v;
            });
            E.doc.cells = cells;
            E.doc.segs = Object.assign({}, E.doc.segs);
            if (list.length > 1) E.doc.segs[Nv.segKey(ymd, post.name)] = list;
            else delete E.doc.segs[Nv.segKey(ymd, post.name)];
          });
          box.appendChild(row);
        });
        const sp = box.querySelector('.dsplit');
        if (sp) sp.onclick = () => mutate(() => {
          const last = segs[segs.length - 1];
          // cut the last block in half at a round hour
          const mid = midHM(last.start, last.end);
          const list = segs.slice(0, -1).concat([{ start: last.start, end: mid }, { start: mid, end: last.end }]);
          E.doc.segs = Object.assign({}, E.doc.segs, { [Nv.segKey(ymd, post.name)]: list });
        });
        body.appendChild(box);
      });
    }

    if (E.sel) {
      const bar = el('div', 'selbar');
      bar.innerHTML = `<span class="who">${esc(E.sel.name)}</span>
        <button id="sdrop" class="btn ghost sm">הסר מהמשמרת</button>
        <button id="scancel" class="btn ghost sm">בטל</button>`;
      body.appendChild(bar);
      body.appendChild(el('div', 'note', 'עכשיו לחץ על שם אחר כדי להחליף ביניהם, או על "כאן" במשבצת ריקה כדי להעביר לשם.'));
      $('#scancel').onclick = () => { E.sel = null; drawEdit(); };
      $('#sdrop').onclick = () => {
        const s = E.sel;
        mutateCells(c => {
          const k = Nv.cellKey(s.ymd, s.si, s.post);
          c[k] = (c[k] || []).filter(x => x !== s.name);
          if (!c[k].length) delete c[k];
        });
      };
    }

    if (E.admin) {
      const acts = el('div', 'inline');
      acts.style.marginTop = '12px';
      acts.innerHTML = `<button id="gfill" class="btn ghost sm">מלא חורים</button>
        <button id="gday" class="btn ghost sm">נקה את היום</button>
        <button id="gall" class="btn ghost sm">בנה הכל מחדש</button>`;
      body.appendChild(acts);
      $('#gfill').onclick = () => mutate(() => {
        const r = NA().autofill(E.doc, { only: 'empty' });
        E.doc = r.doc; E.minRest = r.minRest || 0;
        if (r.warnings && r.warnings.length) setTimeout(() => toast(r.warnings[0]), 60);
      });
      $('#gday').onclick = () => mutateCells(c => {
        Object.keys(c).forEach(k => { if (k.indexOf(ymd + '|') === 0) delete c[k]; });
      });
      $('#gall').onclick = () => {
        if (!confirm('לבנות את כל השבצ״ק מחדש? כל השיבוצים הידניים יימחקו.')) return;
        mutate(() => {
          const r = NA().autofill(E.doc, { only: 'all' });
          E.doc = r.doc; E.minRest = r.minRest || 0;
          if (r.warnings && r.warnings.length) setTimeout(() => toast(r.warnings[0]), 60);
        });
      };
    }

    // a compact load table under the grid — the number people argue about
    body.appendChild(el('div', 'sect', 'עומס'));
    const card = el('div', 'card');
    card.innerHTML = aud.stats.slice(0, 200).map(x =>
      `<div class="crow"><span>${esc(x.name)}</span><b>${x.watch} שמירות${x.duty ? ' · ' + x.duty + ' תורנויות' : ''}${
        x.night ? ' · ' + x.night + ' לילה' : ''}</b></div>`).join('') ||
      '<div class="none sm">אין אנשים</div>';
    body.appendChild(card);
  }

  // halfway between two clock times, rounded to the hour — a sane place to cut
  function midHM(a, b) {
    const P2 = x => { const m = String(x).split(':'); return (+m[0]) * 60 + (+m[1] || 0); };
    let s = P2(a), e = P2(b);
    if (e <= s) e += 1440;
    const m = Math.round((s + (e - s) / 2) / 60) * 60 % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  const isSel = (ymd, si, post, name) =>
    !!(E.sel && E.sel.ymd === ymd && E.sel.si === si && E.sel.post === post && E.sel.name === name);

  function mutateCells(fn) {
    mutate(() => { const c = Object.assign({}, E.doc.cells); fn(c); E.doc.cells = c; E.sel = null; });
  }

  function tapName(ymd, si, post, name) {
    if (!E.admin) return;
    if (isSel(ymd, si, post, name)) { E.sel = null; return drawEdit(); }
    if (!E.sel) { E.sel = { ymd, si, post, name }; return drawEdit(); }
    const a = E.sel, b = { ymd, si, post, name };
    const Nv = NA();
    mutateCells(c => {
      const ka = Nv.cellKey(a.ymd, a.si, a.post), kb = Nv.cellKey(b.ymd, b.si, b.post);
      c[ka] = (c[ka] || []).map(x => x === a.name ? b.name : x);
      c[kb] = (c[kb] || []).map(x => x === b.name ? a.name : x);
    });
  }

  function tapEmpty(ymd, si, post) {
    if (!E.admin) return;
    const Nv = NA();
    if (E.sel) {
      const a = E.sel;
      return mutateCells(c => {
        const ka = Nv.cellKey(a.ymd, a.si, a.post), kb = Nv.cellKey(ymd, si, post);
        c[ka] = (c[ka] || []).filter(x => x !== a.name);
        if (!c[ka].length) delete c[ka];
        c[kb] = (c[kb] || []).concat(a.name);
      });
    }
    pickPerson(ymd, si, post);
  }

  /* Who to put here: everyone, cheapest first, with the reason they're a bad
     idea written on the row rather than hidden behind a rule that blocks them. */
  function pickPerson(ymd, si, post) {
    const D = E.doc, Nv = NA();
    const aud = E.aud || Nv.audit(D, { minRest: E.minRest });
    const load = {}; aud.stats.forEach(s => load[s.name] = s);
    const here = new Set(D.cells[Nv.cellKey(ymd, si, post)] || []);
    const busy = new Set();
    if (si >= 0) D.posts.forEach(p => (D.cells[Nv.cellKey(ymd, si, p.name)] || []).forEach(n => busy.add(n)));

    const wrap = el('div', 'pickwrap');
    const sheet = el('div', 'picksheet');
    sheet.innerHTML = `<div class="sect">מי נכנס ל${esc(post)} · ${esc(Nv.dayLabel(ymd))}${si >= 0 && D.slots[si] ? ' ' + esc(D.slots[si].start) : ''}</div>
      <input id="pq" class="inp" placeholder="חפש שם">
      <div id="plist" style="margin-top:10px"></div>
      <button id="pclose" class="btn ghost">סגור</button>`;
    wrap.appendChild(sheet);
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = e => { if (e.target === wrap) close(); };
    $('#pclose').onclick = close;

    const draw = () => {
      const q = ($('#pq').value || '').trim();
      let list = D.people.filter(n => !here.has(n));
      if (q) {
        const hits = M.rankNames(q, list, 40, null);
        list = hits.length ? hits.map(h => h.name) : list.filter(n => n.indexOf(q) >= 0);
      } else {
        list = list.slice().sort((a, b) => ((load[a] || {}).count || 0) - ((load[b] || {}).count || 0) ||
          ((load[a] || {}).night || 0) - ((load[b] || {}).night || 0) || a.localeCompare(b, 'he'));
      }
      const box = $('#plist');
      box.innerHTML = '';
      list.slice(0, 120).forEach(n => {
        const why = [];
        if (busy.has(n)) why.push('כבר במשמרת הזו');
        if ((D.unavailable[n] || []).includes(ymd)) why.push('לא זמין היום');
        const row = el('button', 'res' + (why.length ? '' : ''));
        row.innerHTML = `<span class="rn">${esc(n)}${why.length ? `<span class="alias">${esc(why.join(' · '))}</span>` : ''}</span>
          <span class="rc">${(load[n] || {}).count || 0} · ${(load[n] || {}).night || 0} לילה</span>`;
        row.onclick = () => {
          close();
          mutateCells(c => {
            const k = Nv.cellKey(ymd, si, post);
            c[k] = (c[k] || []).concat(n);
          });
        };
        box.appendChild(row);
      });
      if (!list.length) box.appendChild(el('div', 'none sm', 'אין מועמדים'));
    };
    $('#pq').oninput = draw;
    draw();
    setTimeout(() => { try { $('#pq').focus(); } catch (e) { } }, 30);
  }

  /* ---- people: add, remove, mark days off ---- */
  function drawPeople(body, aud) {
    const D = E.doc, Nv = NA();
    const load = {}; aud.stats.forEach(s => load[s.name] = s);
    const box = el('div');
    box.innerHTML = `<div class="inline"><input id="pnew" class="inp" placeholder="שם חדש"><button id="padd" class="btn ghost sm">הוסף</button></div>
      <div class="note">אפשר להדביק כמה שמות בבת אחת, אחד בכל שורה.</div>
      <div class="sect">${D.people.length} אנשים</div><div id="plist2"></div>`;
    body.appendChild(box);
    $('#padd').onclick = () => {
      const raw = $('#pnew').value;
      const add = raw.split('\n').map(x => x.trim()).filter(Boolean);
      if (!add.length) return;
      mutate(() => { E.doc.people = E.doc.people.concat(add); });
    };
    const list = $('#plist2');
    D.people.forEach(n => {
      const off = (D.unavailable[n] || []).length;
      const row = el('div', 'prow');
      row.innerHTML = `<span class="pn">${esc(n)}</span>
        <span class="cnt">${(load[n] || {}).count || 0} משמרות${off ? ' · ' + off + ' ימי היעדרות' : ''}</span>`;
      const acts = el('span', 'acts');
      const offb = el('button', 'link sm', 'היעדרויות');
      offb.onclick = () => pickOff(n);
      const del = el('button', 'link danger sm', 'הסר');
      del.onclick = () => {
        if (!confirm('להסיר את ' + n + ' מהשבצ״ק? כל השיבוצים שלו יימחקו.')) return;
        mutate(() => {
          E.doc.people = E.doc.people.filter(x => x !== n);
          const c = Object.assign({}, E.doc.cells);
          Object.keys(c).forEach(k => { c[k] = c[k].filter(x => x !== n); if (!c[k].length) delete c[k]; });
          E.doc.cells = c;
        });
      };
      acts.appendChild(offb); if (E.admin) acts.appendChild(del);
      row.appendChild(acts);
      list.appendChild(row);
    });
    if (!D.people.length) list.appendChild(el('div', 'none sm', 'עוד אין אנשים'));
  }

  function pickOff(name) {
    const D = E.doc, Nv = NA();
    const cur = new Set(D.unavailable[name] || []);
    const wrap = el('div', 'pickwrap');
    const sheet = el('div', 'picksheet');
    sheet.innerHTML = `<div class="sect">ימים ש${esc(name)} לא זמין</div>
      <div class="note">יום מסומן לא ישובץ אוטומטית, ואם הוא כבר משובץ בו זה יופיע ברשימת הבעיות.</div>
      <div id="offdays" class="daystrip" style="flex-wrap:wrap;overflow:visible"></div>
      <button id="offclose" class="btn primary">סיום</button>`;
    wrap.appendChild(sheet); document.body.appendChild(wrap);
    const box = sheet.querySelector('#offdays');
    const paint = () => {
      box.innerHTML = D.days.map(d => `<button class="dchip${cur.has(d) ? ' on' : ''}" data-d="${d}">${esc(Nv.dayLabel(d))}</button>`).join('');
      box.querySelectorAll('.dchip').forEach(b => b.onclick = () => {
        const d = b.dataset.d;
        if (cur.has(d)) cur.delete(d); else cur.add(d);
        paint();
      });
    };
    paint();
    const done = () => {
      wrap.remove();
      mutate(() => {
        const u = Object.assign({}, E.doc.unavailable);
        if (cur.size) u[name] = Array.from(cur).sort(); else delete u[name];
        E.doc.unavailable = u;
      });
    };
    sheet.querySelector('#offclose').onclick = done;
    wrap.onclick = e => { if (e.target === wrap) done(); };
  }

  /* ---- posts, slots, days, title ---- */
  function drawPosts(body) {
    const D = E.doc, Nv = NA();
    const box = el('div');
    box.innerHTML = `
      <label class="lbl">שם השבצ״ק</label>
      <input id="etitle" class="inp" value="${esc(D.title)}">

      <div class="sect">עמדות</div><div id="postlist"></div>
      <div class="inline"><input id="postnew" class="inp" placeholder="עמדה חדשה, למשל: סיור x2"><button id="postadd" class="btn ghost sm">הוסף</button></div>

      <div class="sect">משמרות ביום</div>
      <div id="slotlist"></div>
      <div class="grid2">
        <div><label class="lbl">אורך משמרת</label>
          <select id="eslen" class="sel wide">${[2, 3, 4, 6, 8, 12].map(h => `<option value="${h}">${h} שעות</option>`).join('')}</select></div>
        <div><label class="lbl">מתחיל בשעה</label><input id="esstart" class="inp" type="time" value="${esc((D.slots[0] || {}).start || '02:00')}"></div>
      </div>
      <button id="eslots" class="btn ghost sm" style="margin-top:8px">בנה מחדש את שעות המשמרות</button>
      <div class="note">שינוי שעות המשמרות מוחק את השיבוצים הקיימים, כי אין להם יותר לאן להיצמד.</div>

      <div class="sect">ימים (${D.days.length})</div>
      <div class="note">${D.days.length ? esc(Nv.dayLabel(D.days[0])) + ' – ' + esc(Nv.dayLabel(D.days[D.days.length - 1])) : 'אין ימים'}</div>
      <div class="inline">
        <button id="dadd" class="btn ghost sm">+ יום</button>
        <button id="dadd7" class="btn ghost sm">+ שבוע</button>
        <button id="ddel" class="btn ghost sm">מחק יום אחרון</button>
      </div>

      <div class="sect">מנוחה בין שמירות</div>
      <div class="note">נקבעת לבד. המילוי האוטומטי לוקח את המרווח הגדול ביותר שעדיין ממלא את כל המשבצות, ואומר לך מה יצא. אם זה לא מספיק, סדר ידנית את מה שחשוב.${
        E.minRest ? '<br>בפעם האחרונה יצא ' + E.minRest + ' משמרות.' : ''}</div>`;
    body.appendChild(box);

    $('#etitle').onchange = () => mutate(() => { E.doc.title = $('#etitle').value; });

    const pl = $('#postlist');
    const otherPosts = n => D.posts.filter(x => x.name !== n).map(x => x.name);
    D.posts.forEach((p, i) => {
      const card = el('div', 'pcard');
      const daily = p.mode === 'daily';
      card.innerHTML = `
        <div class="phead"><b>${esc(p.name)}</b><button class="link danger sm pdel">הסר</button></div>
        <div class="prow2">
          <select class="sel md"><option value="slot">לפי משמרות</option><option value="daily">כל היום</option></select>
          <label class="mini">כמה<input class="tin per" type="number" min="1" max="20" value="${p.per}"></label>
          <span class="times2">
            <input class="tin t1" type="time" value="${esc(p.start)}">
            <input class="tin t2" type="time" value="${esc(p.end)}">
          </span>
        </div>
        <label class="opt ex"><input type="checkbox" class="cx"${p.exempt ? ' checked' : ''}>
          <span>כוננות. מי שבה לא מקבל שמירות באותו יום</span></label>
        <label class="opt cr"><input type="checkbox" class="cy"${p.carry ? ' checked' : ''}>
          <span>ממשיך ליום שאין בו שיבוץ</span></label>
        <label class="opt fr"><input type="checkbox" class="cf"${p.from ? ' checked' : ''}>
          <span>מאויש ממי שיורד משמירה</span></label>
        <div class="fromwrap">
          <div class="note">מי שסיים את העמדות האלה בשעה שנבחרה נכנס לכאן אוטומטית, ומתעדכן בכל שינוי.</div>
          <div class="chips fromposts"></div>
          <label class="mini">בשעה<input class="tin fat" type="time" value="${esc((p.from && p.from.at) || (D.slots[0] && D.slots[0].start) || '02:00')}"></label>
        </div>`;
      pl.appendChild(card);

      const md = card.querySelector('.md'); md.value = p.mode;
      const per = card.querySelector('.per'), t1 = card.querySelector('.t1'), t2 = card.querySelector('.t2');
      const cx = card.querySelector('.cx'), cy = card.querySelector('.cy'), cf = card.querySelector('.cf');
      const fw = card.querySelector('.fromwrap'), fchips = card.querySelector('.fromposts');
      const fat = card.querySelector('.fat');

      const paint = () => {
        const dly = md.value === 'daily';
        card.querySelector('.times2').style.display = dly ? '' : 'none';
        card.querySelector('.ex').style.display = dly ? '' : 'none';
        card.querySelector('.cr').style.display = dly ? '' : 'none';
        fw.style.display = cf.checked ? '' : 'none';
        card.querySelector('.per').parentNode.style.display = cf.checked ? 'none' : '';
        const picked = (E.doc.posts[i].from && E.doc.posts[i].from.posts) || [];
        fchips.innerHTML = otherPosts(p.name).map(n =>
          `<button class="chip${picked.indexOf(n) >= 0 ? ' on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('') ||
          '<span class="note">אין עמדות אחרות</span>';
        fchips.querySelectorAll('.chip').forEach(b => b.onclick = () => {
          const cur = ((E.doc.posts[i].from || {}).posts || []).slice();
          const j = cur.indexOf(b.dataset.n);
          if (j >= 0) cur.splice(j, 1); else cur.push(b.dataset.n);
          mutate(() => {
            E.doc.posts[i].from = cur.length ? { posts: cur, at: fat.value } : null;
            if (cur.length) E.doc.posts[i].mode = 'daily';
          });
        });
      };
      paint();

      md.onchange = () => mutate(() => { E.doc.posts[i].mode = md.value; });
      per.onchange = () => mutate(() => { E.doc.posts[i].per = Math.max(1, +per.value || 1); });
      t1.onchange = () => mutate(() => { E.doc.posts[i].start = t1.value; });
      t2.onchange = () => mutate(() => { E.doc.posts[i].end = t2.value; });
      cx.onchange = () => mutate(() => { E.doc.posts[i].exempt = cx.checked; if (cx.checked) E.doc.posts[i].mode = 'daily'; });
      cy.onchange = () => mutate(() => { E.doc.posts[i].carry = cy.checked; });
      cf.onchange = () => {
        if (!cf.checked) return mutate(() => { E.doc.posts[i].from = null; });
        paint();                                     // show the picker; nothing to save until a post is chosen
      };
      fat.onchange = () => { if (E.doc.posts[i].from) mutate(() => { E.doc.posts[i].from.at = fat.value; }); };
      card.querySelector('.pdel').onclick = () => {
        if (!confirm('להסיר את ' + p.name + '?')) return;
        mutate(() => { E.doc.posts = E.doc.posts.filter((_, j) => j !== i); });
      };
    });
    if (!D.posts.length) pl.appendChild(el('div', 'none sm', 'אין עמדות'));
    $('#postadd').onclick = () => {
      const add = parsePostLines($('#postnew').value);
      if (!add.length) return;
      mutate(() => { E.doc.posts = E.doc.posts.concat(add); });
    };

    $('#slotlist').innerHTML = D.slots.length
      ? '<div class="note" dir="ltr" style="text-align:start">' + D.slots.map(s => esc(s.start + '-' + s.end)).join(' · ') + '</div>'
      : '<div class="none sm">אין משמרות</div>';
    $('#eslen').value = String(slotLenHours(D.slots) || 4);
    $('#eslots').onclick = () => {
      if (D.slots.length && !confirm('לבנות מחדש את שעות המשמרות? השיבוצים הקיימים יימחקו.')) return;
      mutate(() => {
        E.doc.slots = SHGen.slotsEvery($('#esstart').value || '02:00', +$('#eslen').value || 4);
        const c = {};
        Object.keys(E.doc.cells).forEach(k => { if (k.split('|')[1] === '-1') c[k] = E.doc.cells[k]; });
        E.doc.cells = c;                       // daily posts survive; slotted ones can't
      });
    };

    const lastDay = () => D.days[D.days.length - 1] || todayYMD();
    const addDays = n => mutate(() => {
      let d = E.doc.days.length ? lastDay() : NA().addDays(todayYMD(), -1);
      const out = E.doc.days.slice();
      for (let i = 0; i < n; i++) { d = NA().addDays(d, 1); out.push(d); }
      E.doc.days = out;
    });
    $('#dadd').onclick = () => addDays(1);
    $('#dadd7').onclick = () => addDays(7);
    $('#ddel').onclick = () => {
      if (!D.days.length) return;
      if (!confirm('למחוק את ' + NA().dayLabel(lastDay()) + ' על כל השיבוצים שבו?')) return;
      mutate(() => { E.doc.days = E.doc.days.slice(0, -1); });
    };
  }
  function slotLenHours(slots) {
    if (!slots || !slots.length) return 4;
    const a = slots[0].start.split(':'), b = slots[0].end.split(':');
    let m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]);
    if (m <= 0) m += 1440;
    return Math.round(m / 60);
  }

  function drawIssues(body, aud) {
    const D = E.doc;
    const f = aud.fairness;
    if (f) {
      const card = el('div', 'card');
      const duties = aud.stats.map(s => s.duty);
      const dLo = Math.min.apply(null, duties), dHi = Math.max.apply(null, duties);
      card.innerHTML = `<div class="crow"><span>שמירות לכל אחד</span><b>${f.min === f.max ? f.min : f.min + '–' + f.max}</b></div>
        <div class="crow"><span>לילות לכל אחד</span><b>${f.nightMin === f.nightMax ? f.nightMin : f.nightMin + '–' + f.nightMax}</b></div>
        ${dHi ? `<div class="crow"><span>תורנויות לכל אחד</span><b>${dLo === dHi ? dLo : dLo + '–' + dHi}</b></div>` : ''}
        <div class="crow"><span>סה״כ שיבוצים</span><b>${aud.stats.reduce((a, s) => a + s.count, 0)}</b></div>`;
      body.appendChild(card);
    }
    const groups = [['hole', 'משבצות ריקות'], ['exempt', 'כוננות שקיבלה שמירה'], ['double', 'שיבוץ כפול'],
                    ['rest', 'מנוחה קצרה'], ['off', 'משובץ ביום היעדרות']];
    let any = false;
    groups.forEach(([k, label]) => {
      const list = aud.issues.filter(i => i.kind === k);
      if (!list.length) return;
      any = true;
      body.appendChild(el('div', 'sect', label + ' (' + list.length + ')'));
      const card = el('div', 'card');
      list.slice(0, 60).forEach(i => {
        const row = el('div', 'issue');
        row.textContent = i.text;
        row.style.cursor = 'pointer';
        row.onclick = () => { const d = E.doc.days.indexOf(i.ymd); if (d >= 0) { E.day = d; E.tab = 'grid'; drawEdit(); } };
        card.appendChild(row);
      });
      if (list.length > 60) card.appendChild(el('div', 'note', 'ועוד ' + (list.length - 60) + '…'));
      body.appendChild(card);
    });
    if (!any) body.appendChild(el('div', 'none', 'הכל תקין ✓'));
  }

  /* ---------- add to home screen ---------- */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const platform = () => {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) return /crios|fxios|edgios/i.test(ua) ? 'ios-other' : 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
  };

  function screenInstall() {
    const v = $('#view'); v.innerHTML = '';
    const pf = platform();
    const done = isStandalone();
    const steps = {
      ios: ['פתח את האפליקציה ב-Safari (לא בכרום)',
        'לחץ על כפתור <b>שיתוף</b> ⬆︎ בסרגל התחתון',
        'גלול ובחר <b>הוספה למסך הבית</b>',
        'לחץ <b>הוספה</b> בפינה',
        'פתח את האפליקציה מהאייקון החדש, לא מהדפדפן'],
      'ios-other': ['באייפון זה עובד רק מ-Safari',
        'העתק את הכתובת, פתח אותה ב-Safari, וחזור לכאן'],
      android: ['פתח את תפריט הדפדפן (⋮ בפינה)',
        'בחר <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>',
        'אשר, ופתח מהאייקון החדש'],
      desktop: ['לחץ על אייקון ההתקנה בשורת הכתובת',
        'או: תפריט הדפדפן ← <b>התקן</b>'],
    }[pf];

    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">התקנה למסך הבית</div>
      <p class="sub">${done
        ? 'האפליקציה כבר מותקנת. הכל עובד.'
        : pf === 'ios'
          ? 'באייפון <b>חובה</b> להתקין כדי לקבל התראות. אפל לא שולחת התראות ללשונית רגילה בספארי.'
          : 'התקנה נותנת אייקון משלה, פתיחה מהירה והתראות.'}</p>
      ${done ? '' : `<ol class="steps">${steps.map(x => '<li>' + x + '</li>').join('')}</ol>`}
      ${!done && installEvent ? '<button id="doinstall" class="btn primary">התקן עכשיו</button>' : ''}
      ${!done && pf === 'ios' ? `<div class="note">אם לא רואים "הוספה למסך הבית", גלול למטה ברשימת השיתוף. זה מתחת לאפשרויות השיתוף.</div>` : ''}
      ${pf === 'ios-other' ? `<button id="copyurl" class="btn ghost">העתק את הכתובת</button>` : ''}
      <button id="back3" class="btn ghost">חזרה</button>`;
    v.appendChild(c);
    const di = $('#doinstall');
    if (di) di.onclick = async () => {
      installEvent.prompt();
      const r = await installEvent.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') toast('מותקן'); 
      installEvent = null; screenInstall();
    };
    const cu = $('#copyurl');
    if (cu) cu.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href); toast('הועתק'); };
    $('#back3').onclick = route;
  }

  /* ---------- hours leaderboard ---------- */
  const LB = { period: 'all', includeDaily: false };   // the sheet itself is the natural period

  // How much of a shift falls between 22:00 and 06:00, in hours. Sampled at 15
  // minutes rather than reasoned about — shifts cross midnight and DST, and
  // being obviously right matters more here than being clever.
  function nightHours(s, e) {
    let n = 0;
    const step = 15 * 60000;
    for (let t = s; t < e; t += step) {
      const h = zparts(t).h;
      if (h >= 22 || h < 6) n += step;
    }
    return n / 3600000;
  }

  function periodStart(kind, now) {
    if (kind === 'all') return 0;
    const p = zparts(now);
    if (kind === 'month') return zonedMidnight(p.y, p.mo, 1);
    const dow = p.wd;                                  // week starts Sunday
    return zonedMidnight(p.y, p.mo, p.d) - dow * 864e5;
  }
  function zonedMidnight(y, mo, d) {
    // walk back from a UTC guess until the local date matches at 00:00
    let t = Date.UTC(y, mo - 1, d, 12, 0);
    const q = zparts(t);
    t -= (q.h * 60 + q.mi) * 60000;
    return t;
  }

  function leaderRows(now) {
    const from = periodStart(LB.period, now);
    const rules = (S.roster && S.roster.rules) || {};
    const isDailyPost = post => !!rules[nk(post)];
    const by = new Map();
    shifts().forEach(s2 => {
      if (s2.x) return;
      if (s2.e > +now) return;                         // only what's actually been done
      if (s2.s < from) return;
      if (!LB.includeDaily && isDailyPost(s2.p)) return;
      const k = s2.n;
      if (!by.has(k)) by.set(k, { name: k, hours: 0, shifts: 0, night: 0 });
      const r = by.get(k);
      r.hours += (s2.e - s2.s) / 3600000;
      r.night += nightHours(s2.s, s2.e);
      r.shifts++;
    });
    return Array.from(by.values())
      .sort((a, b) => b.hours - a.hours || b.night - a.night || a.name.localeCompare(b.name, 'he'));
  }

  const fmtH = h => {
    const m = Math.round(h * 60);
    return Math.floor(m / 60) + ':' + pad(m % 60);
  };

  function renderLeader(host) {
    const now = new Date();
    const rows = leaderRows(now);
    const me = S.viewing || S.me;
    const total = rows.reduce((a, r) => a + r.hours, 0);
    const avg = rows.length ? total / rows.length : 0;
    const myIdx = rows.findIndex(r => nk(r.name) === nk(me));
    const mine = myIdx >= 0 ? rows[myIdx] : null;

    host.innerHTML = `
      <div class="chips" id="lbper">
        ${[['all', 'כל השבצ״ק'], ['week', 'השבוע'], ['month', 'החודש']].map(([k, l]) =>
      `<button class="chip${LB.period === k ? ' on' : ''}" data-k="${k}">${l}</button>`).join('')}
        <button class="chip${LB.includeDaily ? ' on' : ''}" data-d="1">כולל תורנויות</button>
      </div>
      ${mine ? `<div class="hero free" style="padding:16px 18px">
          <div class="tag">אתה</div>
          <div class="big">${fmtH(mine.hours)}<span class="unit">שעות</span></div>
          <div class="lead">מקום ${myIdx + 1} מתוך ${rows.length} · ממוצע ${fmtH(avg)}</div>
          <div class="sub2">${mine.hours >= avg
        ? '+' + fmtH(mine.hours - avg) + ' מעל הממוצע'
        : fmtH(avg - mine.hours) + ' מתחת לממוצע'} · ${fmtH(mine.night)} לילה</div>
        </div>` : '<div class="note">אין לך שעות בטווח הזה.</div>'}
      <div class="sect">${rows.length ? 'לפי שעות שכבר בוצעו' : 'אין נתונים בטווח הזה. נסה טווח אחר'}</div>
      <div class="list" id="lblist"></div>`;

    const list = host.querySelector('#lblist');
    rows.forEach((r, i) => {
      const it = el('div', 'item lb' + (nk(r.name) === nk(me) ? ' me' : ''));
      it.innerHTML = `<div class="rank${i < 3 ? ' top' : ''}">${i + 1}</div>
        <div class="i"><div class="p">${esc(r.name)}</div>
          <div class="w">${fmtH(r.hours)} · ${r.shifts === 1 ? 'משמרת אחת' : r.shifts + ' משמרות'}${r.night >= 0.25 ? ' · ' + fmtH(r.night) + ' לילה' : ''}</div></div>`;
      it.onclick = () => { S.viewing = r.name; route(); };
      list.appendChild(it);
    });

    host.querySelectorAll('#lbper .chip').forEach(b => b.onclick = () => {
      if (b.dataset.d) LB.includeDaily = !LB.includeDaily; else LB.period = b.dataset.k;
      renderLeader(host);
    });
  }

  function screenLeader() {
    const v = $('#view'); v.innerHTML = '';
    const c = el('div');
    c.innerHTML = `<div class="topbar"><button class="who" id="back5">טבלת שעות<span class="chev">›</span></button></div>
      <div id="lbpane"></div>`;
    v.appendChild(c);
    renderLeader($('#lbpane'));
    $('#back5').onclick = setTools;
  }

  /* ---------- who is on every post, right now ---------- */
  function screenBoard() {
    const v = $('#view'); v.innerHTML = '';
    const now = new Date();
    const all = shifts().filter(s => !s.x);

    /* Every post the roster knows about, not only the ones with somebody on
       them right now. A post that drops off the list the moment it empties is
       exactly the post you most wanted to see — מטבח between 00:00 and 07:00,
       or a column whose week has run out.

       Keyed by tab AND post, because two tabs commonly use the same word. A
       סיור in מבוא דותן is not the סיור in תגבצים, and merging them produced
       one row with eleven people on it, the end time of whichever shift ran
       longest, and a "next" from the wrong roster entirely. */
    const byKey = new Map();
    const K = (tab, post) => (tab || '') + '\u0000' + post;
    all.forEach(s => {
      if (!s.p) return;
      const k = K(s.t, s.p);
      if (!byKey.has(k)) byKey.set(k, { post: s.p, tab: s.t || '', list: [] });
      byKey.get(k).list.push(s);
    });
    // a post the parser saw but that has no shift at all still deserves a row
    (S.roster.posts || []).forEach(post => {
      if (![...byKey.values()].some(r => r.post === post)) byKey.set(K('', post), { post, tab: '', list: [] });
    });

    const rows = [...byKey.values()].map(r => {
      const on = r.list.filter(s => s.s <= +now && +now < s.e);
      const next = r.list.filter(s => s.s > +now).sort((a, b) => a.s - b.s)[0];
      const last = r.list.filter(s => s.e <= +now).sort((a, b) => b.e - a.e)[0];
      // nothing now, nothing ahead: the roster simply doesn't reach today
      const dormant = !on.length && !next;
      return { post: r.post, tab: r.tab, on, next, last, dormant,
               sort: on.length ? 0 : dormant ? 2 : 1 };
    }).sort((a, b) => a.sort - b.sort ||
      (a.tab || '').localeCompare(b.tab || '', 'he') || a.post.localeCompare(b.post, 'he'));

    const live = rows.filter(r => !r.dormant);
    const manned = live.filter(r => r.on.length).length;
    const tabs = [...new Set(rows.map(r => r.tab).filter(Boolean))];

    const staff = ((S.roster && S.roster.contacts) || []).length;
    const c = el('div');
    c.innerHTML = `<div class="topbar"><button class="who" id="back2">מי בשמירה עכשיו<span class="chev">›</span></button>
        <div class="tools"><button class="icon" id="again2" title="רענן">${ICON.refresh}</button></div></div>
      ${staff ? `<div class="tabs">
        <button class="tb${BT === 'posts' ? ' on' : ''}" data-b="posts">עמדות</button>
        <button class="tb${BT === 'staff' ? ' on' : ''}" data-b="staff">מפקדים וקצינים${staff ? ' · ' + staff : ''}</button>
      </div>` : ''}
      <div class="note">${BT === 'staff' ? hm(now) + ' · ' + staff + ' אנשי קשר'
        : hm(now) + ' · ' + manned + ' מתוך ' + live.length + ' עמדות מאוישות' +
          (rows.length > live.length ? ' · ' + (rows.length - live.length) + ' ללא שיבוץ בשבצ״ק' : '')}</div>
      <div id="board" class="list"></div>
      <div id="contacts"></div>`;
    v.appendChild(c);
    $('#back2').onclick = route;
    $('#again2').onclick = async () => { try { await loadRoster(); } catch (e) { } screenBoard(); };
    c.querySelectorAll('.tb').forEach(b => b.onclick = () => { BT = b.dataset.b; screenBoard(); });
    if (staff && BT === 'staff') { drawStaff($('#board'), now); return; }

    /* If the person standing the watch is himself on the contact list, put the
       call button on his row. The חמ״ל's ask was "the numbers, on the on-watch
       screen" — and the number you want first is the one belonging to whoever
       is actually out there. */
    const book = contactIndex();
    const bd = $('#board');
    /* Ordered by what needs attention, not by which tab it came from — so the
       tab rides on the row instead of splitting the list into repeated
       headings, which is what happens when you group by a secondary key. */
    let head = null;
    rows.forEach(r => {
      const group = r.on.length ? 'מאוישות עכשיו' : r.dormant ? 'לא בשבצ״ק הנוכחי' : 'ממתינות לשמירה';
      if (group !== head) { head = group; bd.appendChild(el('div', 'daysep', group)); }
      const it = el('div', 'item board' + (r.on.length ? '' : r.dormant ? ' empty dim' : ' empty'));
      /* The digits themselves, as selectable text — the number gets copied into
         a report or a WhatsApp far more often than it gets dialled. The icon
         beside it is the call; the text is left alone so a long-press selects
         it instead of following a link. */
      const names = r.on.map(s => {
        const c = book(s.n);
        return esc(s.n) + (c ? `<span class="tel" dir="ltr">${esc(c.phone)}</span>` +
          `<a class="callin" href="${esc(NA().telHref(c.phone))}" title="${esc(c.role || 'התקשר')}">${ICON.phone}</a>` : '');
      }).join(', ');
      const state = r.on.length
        ? names + ' · עד ' + hm(D(r.on[0].e))
        : r.dormant
          ? '<span class="dimmer">' + (r.last ? 'הסתיים ' + esc(dayLabel(D(r.last.e), now)) : 'אין שיבוץ') + '</span>'
          : '<span class="warn">לא מאויש</span>';
      it.innerHTML = `<div class="i" style="flex-direction:column;align-items:stretch;gap:3px">
          <div class="p"><b>${esc(r.post)}</b>${tabs.length > 1 && r.tab ? `<span class="dimmer"> · ${esc(r.tab)}</span>` : ''}</div>
          <div class="w">${state}</div>
          ${r.next ? `<div class="w dimmer">הבא: ${esc(r.next.n)} ${esc(dayLabel(D(r.next.s), now))} ב-${hm(D(r.next.s))}</div>` : ''}
        </div>`;
      it.onclick = e => {
        if (e.target.closest('.callin')) return;          // tapping the number calls, not navigates
        if (r.on.length) { S.viewing = r.on[0].n; route(); }
      };
      bd.appendChild(it);
    });
    if (!rows.length) bd.appendChild(el('div', 'none', 'אין עמדות בשבצ״ק'));

    if (!staff) drawContacts($('#contacts'));      // no tabs to switch to: keep it inline
  }

  let BT = 'posts';

  /* The סגל, and where each of them actually is. The contact list on its own
     answers "what's his number"; this answers "is he even awake" — which is the
     question you have at 03:00 before you decide who to ring. */
  function drawStaff(host, now) {
    const list = ((S.roster && S.roster.contacts) || []);
    const all = shifts().filter(s => !s.x);
    const names = [...new Set(all.map(s => s.n).filter(Boolean))];

    const rows = list.map(c => {
      // the roster spells people its own way; match it the way search does
      let who = null;
      if (c.name) {
        const t = nk(c.name);
        who = names.find(n => nk(n) === t) || null;
        if (!who) { const r = M.rankNames(c.name, names, 1, (S.roster && S.roster.aliases) || null)[0]; if (r && r.score >= 0.9) who = r.name; }
      }
      const mineS = who ? all.filter(s => s.n === who).sort((a, b) => a.s - b.s) : [];
      const on = mineS.find(s => s.s <= +now && +now < s.e);
      const next = mineS.find(s => s.s > +now);
      return { c, who, on, next, any: mineS.length, sort: on ? 0 : next ? 1 : mineS.length ? 2 : 3 };
    }).sort((a, b) => a.sort - b.sort || (a.next && b.next ? a.next.s - b.next.s : 0) ||
      (a.c.name || '').localeCompare(b.c.name || '', 'he'));

    rows.forEach(r => {
      const it = el('div', 'item staff' + (r.on ? ' live' : ''));
      const where = r.on
        ? `<b class="onnow">עכשיו · ${esc(r.on.p || '')}</b> עד ${hm(D(r.on.e))}`
        : r.next
          ? `<span class="dimmer">${esc(dayLabel(D(r.next.s), now))} ב-${hm(D(r.next.s))} · ${esc(r.next.p || '')}</span>`
          : r.any ? '<span class="dimmer">אין שמירות קרובות</span>'
                  : '<span class="dimmer">לא מופיע בשבצ״ק</span>';
      it.innerHTML = `<div class="i" style="flex-direction:column;align-items:stretch;gap:3px">
          <div class="p"><b>${esc(r.c.name || '')}</b>${r.c.role ? `<span class="dimmer"> · ${esc(r.c.role)}</span>` : ''}</div>
          <div class="w">${where}</div>
          ${r.c.phone ? `<div class="w tel" dir="ltr" style="text-align:start;font-size:14px">${esc(r.c.phone)}</div>` : ''}
        </div>
        ${r.c.phone ? `<span class="acts2">
          <button class="icon cp" title="העתק">${ICON.copy}</button>
          <a class="icon" href="${esc(NA().telHref(r.c.phone))}" title="התקשר">${ICON.phone}</a>
        </span>` : ''}`;
      const cp = it.querySelector('.cp');
      if (cp) cp.onclick = async e => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(r.c.phone); toast('הועתק: ' + r.c.phone); }
        catch (err) { toast(r.c.phone); }
      };
      if (r.who) it.onclick = e => { if (e.target.closest('.acts2')) return; S.viewing = r.who; route(); };
      host.appendChild(it);
    });
    if (!rows.length) host.appendChild(el('div', 'none', 'אין אנשי קשר'));
    host.appendChild(el('div', 'note', 'לחיצה על שורה פותחת את השבצ״ק של אותו אדם. הרשימה נערכת בהגדרות.'));
  }

  /* Contacts are typed by hand and rosters spell people every which way, so the
     match is the same fuzzy one the search box uses — exact first, then a
     confident fuzzy hit. Built once per render, not once per name. */
  function contactIndex() {
    const list = ((S.roster && S.roster.contacts) || []).filter(c => c.phone);
    if (!list.length) return () => null;
    const exact = new Map();
    list.forEach(c => { if (c.name) exact.set(nk(c.name), c); });
    const names = list.map(c => c.name).filter(Boolean);
    const cache = new Map();
    return who => {
      if (!who) return null;
      if (cache.has(who)) return cache.get(who);
      let hit = exact.get(nk(who)) || null;
      if (!hit && names.length) {
        const r = M.rankNames(who, names, 1, null)[0];
        if (r && r.score >= 0.9) hit = list.find(c => c.name === r.name) || null;
      }
      cache.set(who, hit);
      return hit;
    };
  }

  /* The list the חמ״ל asked for: whoever is standing the watch can reach the
     duty officer without asking anybody for a number first. */
  function drawContacts(host) {
    const list = (S.roster && S.roster.contacts) || [];
    if (!host || !list.length) return;
    host.innerHTML = `<div class="sect">מפקדים וקצינים</div>`;
    const card = el('div', 'list');
    list.forEach(x => {
      const row = el('div', 'item contact');
      row.innerHTML = `<div class="i" style="flex-direction:column;align-items:stretch;gap:2px">
          <div class="p"><b>${esc(x.name || '')}</b>${x.role ? `<span class="dimmer"> · ${esc(x.role)}</span>` : ''}</div>
          ${x.phone ? `<div class="w tel" dir="ltr" style="text-align:start;font-size:14px">${esc(x.phone)}</div>` : ''}</div>
        ${x.phone ? `<span class="acts2">
           <button class="icon cp" title="העתק">${ICON.copy}</button>
           <a class="icon" href="${esc(NA().telHref(x.phone))}" title="התקשר">${ICON.phone}</a>
         </span>` : ''}`;
      const cp = row.querySelector('.cp');
      if (cp) cp.onclick = async () => {
        try { await navigator.clipboard.writeText(x.phone); toast('הועתק: ' + x.phone); }
        catch (e) { toast(x.phone); }        // no clipboard permission: at least show it big
      };
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  /* ---------- diagnostics: what the parser actually read ---------- */
  function screenDiag() {
    const v = $('#view'); v.innerHTML = '';
    const who = S.viewing || S.me;
    const now = new Date();
    const all = mine(who).slice().sort((a, b) => a.s - b.s);
    const c = el('div', 'setup');
    c.innerHTML = `
      <div class="logo sm">אבחון</div>
      <p class="sub">${isNative() ? 'כל מה שרשום עליך בשבצ״ק, בדיוק כפי שהאפליקציה רואה אותו.' : 'מה שהאפליקציה קראה מהגיליון, בדיוק. השווה מול הגיליון עצמו.'}</p>
      <div class="sect">מצב סנכרון</div>
      <div class="card" id="dsync"></div>
      <div class="sect">כל השיבוצים של ${esc(who)} (${all.length})</div>
      <div id="dl" class="list"></div>
      <div class="sect">מה זוהה בכל לשונית</div>
      <div id="dt"></div>
      <div class="sect">אזהרות</div>
      <div id="dw"></div>
      <button id="back" class="btn ghost">חזרה</button>`;
    v.appendChild(c);

    /* Three timestamps, because they fail independently and the difference is
       the whole diagnosis: an unchanged שבצ״ק, a stuck sheet, or a dead cron. */
    const since = t => !t ? 'לא ידוע' : (m => m < 2 ? 'עכשיו' : m < 90 ? 'לפני ' + m + ' דק׳'
      : 'לפני ' + Math.round(m / 60) + ' שעות')(Math.round((Date.now() - t) / 60000));
    const R = S.roster || {};
    $('#dsync').innerHTML =
      `<div class="crow"><span>השרת בדק את השבצ״ק</span><b>${esc(since(R.lastPoll))}</b></div>
       <div class="crow"><span>השבצ״ק השתנה</span><b>${esc(since(R.lastChange || R.updatedAt))}</b></div>
       <div class="crow"><span>סבב הבדיקה של השרת</span><b>${esc(since(R.lastTick))}</b></div>` +
      (R.lastError ? `<div class="crow"><span>שגיאה</span><b class="warn">${esc(R.lastError)}</b></div>` : '') +
      (!R.lastTick || Date.now() - R.lastTick > 20 * 60000
        ? `<div class="note">הסבב אמור לרוץ כל 5 דקות. אם הוא תקוע ואין שגיאה, זו כמעט תמיד מגבלת ה-CPU של Workers Free. ניתוח שבצ״ק לוקח יותר מ-10ms והבקשה נהרגת בלי להשאיר עקבות. שדרוג ל-Workers Paid פותר.</div>`
        : '');

    const dl = $('#dl');
    if (!all.length) dl.appendChild(el('div', 'none sm', 'לא נמצא אף שיבוץ על השם הזה'));
    all.forEach(s2 => {
      const past = s2.e <= +now, live = s2.s <= +now && +now < s2.e;
      const it = el('div', 'item' + (live ? ' live' : ''));
      it.style.opacity = past && !live ? '.45' : '1';
      it.innerHTML = `<div class="t">${hm(D(s2.s))}<span class="to">–${hm(D(s2.e))}</span></div>
        <div class="i"><div class="p">${esc(s2.p || '—')}<span class="dimmer"> · ${esc(s2.t || '')}</span></div>
        <div class="w">${live ? '<b>עכשיו</b>' : dayLabel(D(s2.s), now)}</div>
        ${s2.d ? `<div class="dimmer">מהתא: “${esc(s2.d)}”${s2.r ? ' · שורה ' + s2.r : ''}</div>` : ''}</div>`;
      dl.appendChild(it);
    });

    const dt = $('#dt');
    ((S.roster && S.roster.diags) || []).forEach(d => {
      const row = el('div', 'crow');
      const good = d.shifts > 0;
      row.innerHTML = `<span>${esc(d.title)}</span><b>${good
        ? d.shifts + ' שיבוצים · ' + (d.transposed ? 'מאונך · ' : '') + 'ציר: ' + esc(d.colAxis || '?')
        : '<span class="warn">' + esc(d.reason || 'לא נקרא') + '</span>'}</b>`;
      dt.appendChild(row);
      /* Per column, because "עמדה X לא נספרת" is the report that actually comes
         in, and a zero next to its name answers it in one look. */
      (d.columns || []).forEach(cl => {
        const r2 = el('div', 'crow');
        r2.style.paddingInlineStart = '14px';
        r2.innerHTML = `<span class="dimmer">${esc(cl.name)}</span>` +
          (cl.n ? `<span class="rc">${cl.n}</span>` : '<b class="warn">0</b>');
        dt.appendChild(r2);
      });
    });
    if (!dt.children.length) dt.appendChild(el('div', 'none sm', 'אין מידע. לחץ בדוק עכשיו'));

    const dw = $('#dw');
    const ws = (S.roster && S.roster.warnings) || [];
    ws.length ? ws.forEach(w => dw.appendChild(el('div', 'note', esc(w))))
      : dw.appendChild(el('div', 'none sm', 'אין'));
    $('#back').onclick = setTools;
  }

  /* ---------- push ---------- */
  /* Permission granted on some earlier visit doesn't mean the server still has a
     subscription — a reinstall or a cleared profile drops it. Re-register
     quietly on boot so notifications don't just stop without anyone noticing. */
  async function ensurePush() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator) || !S.cfg || !S.cfg.vapidPublic) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing && LS.get('pushed', '') === existing.endpoint) return;   // already known to the server
      await subscribePush();
      const sub = await reg.pushManager.getSubscription();
      if (sub) LS.set('pushed', sub.endpoint);
    } catch (e) { }
  }

  async function subscribePush() {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(S.cfg.vapidPublic) });
    await api('/api/push/subscribe', { subscription: sub.toJSON() });
    tellSW();
  }
  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await api('/api/push/unsubscribe', {});
  }
  function urlB64(s) {
    const p = '='.repeat((4 - s.length % 4) % 4);
    const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  }
  /* ---------- the iOS shell ----------
     Inside the native app the same web UI runs in a web view. The only things
     it needs from us are a widget token, once, and a nudge whenever the roster
     moves so the widget can redraw. Everything is wrapped in a check, because
     in a normal browser none of this exists. */
  const iosBridge = () => (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sh) || null;
  const androidBridge = () => (window.ShavtzakAndroid && typeof window.ShavtzakAndroid.post === 'function') ? window.ShavtzakAndroid : null;
  const native = () => iosBridge() || androidBridge();
  const toNative = m => {
    try {
      const ios = iosBridge();
      if (ios) return ios.postMessage(m);
      // Android's bridge only passes strings across
      const a = androidBridge();
      if (a) a.post(JSON.stringify(m));
    } catch (e) { }
  };
  async function linkWidget() {
    if (!native() || !S.sid) return;
    try {
      let r = await api('/api/widget/token');
      if (!r.token) r = await api('/api/widget/token', {});
      if (r.token) toNative({ type: 'widget', token: r.token, origin: location.origin });
    } catch (e) { }
  }

  function tellSW() {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'sid', sid: S.sid });
      navigator.serviceWorker.controller.postMessage({ type: 'badge', off: !!LS.get('badgeOff', 0) });
    }
  }

  /* ---------- countdown ---------- */
  let lastKey = '';
  setInterval(() => {
    const cd = $('#cd'); if (!cd || !S.roster) return;
    const who = S.viewing || S.me; if (!who) return;
    const now = new Date(), st = statusFor(who, now);
    const key = st.current ? 'c' + st.current.s : st.next ? 'n' + st.next.s : 'x';
    if (lastKey && key !== lastKey) { lastKey = key; setBadge(); render(); return; }
    lastKey = key;
    if (st.current) cd.innerHTML = durHTML(st.current.e - now);
    else if (st.next) cd.innerHTML = durHTML(st.next.s - now);
    const bar = document.querySelector('.bar i');
    if (bar && st.current) bar.style.width = Math.min(100, 100 * (now - st.current.s) / (st.current.e - st.current.s)) + '%';
  }, 1000);

  /* ---------- boot ---------- */
  // push a locally-remembered name back to the server if it ever comes back blank
  async function syncMe(name) {
    try { await api('/api/me', { sheet: S.sheet, person: name }); } catch (e) { }
  }

  async function loadSheets() {
    const r = await api('/api/sheets');
    S.sheets = r.sheets || [];
    if (!S.sheet || !S.sheets.some(x => x.id === S.sheet)) S.sheet = r.active || (S.sheets[0] && S.sheets[0].id) || null;
    LS.set('sheet', S.sheet);
  }
  async function loadRoster() {
    if (!S.sheet) { S.roster = null; return; }
    let r;
    try {
      r = await api(sq('/api/roster'));
    } catch (e) {
      const cached = LS.get('roster:' + S.sheet, null);
      if (e.offline && cached) { S.roster = cached; S.me = cached.me || S.me; S.offline = true; return; }
      throw e;
    }
    S.offline = false;
    if (r.empty) { S.roster = null; return; }
    /* The chosen name is deliberately sticky. A שבצ"ק gets rewritten every week
       and people drop out of it all the time — being dropped from this week's
       roster must never log you out of your own name. */
    if (r.me) LS.set('me:' + S.sheet, r.me);
    else { const kept = LS.get('me:' + S.sheet, null); if (kept) { r.me = kept; syncMe(kept); } }
    r.names = r.names || []; r.shifts = r.shifts || []; r.aliases = r.aliases || {}; r.locations = r.locations || {};
    try { LS.set('roster:' + S.sheet, r); } catch (e) { }
    S.roster = r; S.me = r.me || null;
    S.nicknames = r.nicknames || []; S.lastSeen = r.lastSeen || 0;
    if (r.account) { S.account = r.account; LS.set('account', r.account); }
    applyNicknames();
    setBadge();
    toNative({ type: 'refresh' });                 // redraw the widget, if we're in it
    try { S.changes = await api(sq('/api/changes')); } catch (e) { console.warn('changes:', e.message); }
  }
  async function switchSheet(id) {
    S.sheet = id; LS.set('sheet', id);
    S.roster = null; S.me = null; S.viewing = null; S.changes = null;
    try { await loadRoster(); } catch (e) { toast(e.message); }
    route();
  }
  function route() {
    if (!S.cfg) return;
    if (!S.sid) return screenSignIn();
    if (pendingInvite) { redeemInvite(pendingInvite); return; }
    if (!S.sheets.length) return screenAddSheet();
    if (!S.roster) return;
    if (!S.me) return screenPick(false);
    /* Long-pressing the icon on Android opens one of the manifest shortcuts.
       Consumed once, so the next render goes to the main screen as usual. */
    if (openHash) {
      const h = openHash; openHash = '';
      if (h === '#board') return screenBoard();
      if (h === '#guide') return screenGuide();
    }
    return screenMain();
  }
  let openHash = '';
  function render() { if (S.roster && S.me && !document.querySelector('.setup')) screenMain(); }

  async function boot() {
    if (window.__shBooted) window.__shBooted();
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); tellSW(); } catch (e) { }
    }
    const inv = location.hash.match(/[#&][ig]=([A-Za-z0-9]+)/);
    if (inv) pendingInvite = inv[1].toUpperCase();
    else if (location.hash === '#board' || location.hash === '#guide') openHash = location.hash;
    try { S.cfg = await api('/api/config'); LS.set('cfg', S.cfg); }
    catch (e) {
      S.cfg = LS.get('cfg', null);
      if (!S.cfg) return screenOffline(e);           // never been online here before
      S.offline = true;                              // known config: carry on from cache
    }
    if (!S.sid) {
      // localStorage can be wiped (Safari clears script storage after ~7 idle
      // days, and an installed app may not share the tab's bucket) while the
      // session cookie is still good. Recover instead of demanding a login.
      try {
        const ses = await api('/api/session');
        if (ses && ses.sid) { S.sid = ses.sid; S.account = ses.account; LS.set('sid', ses.sid); }
      } catch (e) { }
    }
    if (!S.sid) return screenSignIn();

    try { await loadSheets(); }
    catch (e) {
      if (e.auth) return screenSignIn(e);
      return screenOffline(e);                       // signed in, just unreachable
    }
    if (S.sheet) { try { await loadRoster(); } catch (e) { if (e.auth) return screenSignIn(e); } }
    // the builder demo opens straight into the editor rather than the roster
    if (globalThis.__demoEditor) { try { return await screenEdit(globalThis.__demoEditor); } catch (e) { } }
    route();
    tellSW();
    linkWidget();
    checkBuild();
    ensurePush();
    setInterval(async () => { try { await loadRoster(); render(); } catch (e) { } }, 3 * 60000);
    setInterval(checkBuild, 15 * 60000);
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      // reopening is the natural moment to pick up a new build; there is no
      // unsaved state to lose
      await checkBuild();
      if (newBuild) return doUpdate();
      try { await loadRoster(); } catch (e) { }
      render();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
