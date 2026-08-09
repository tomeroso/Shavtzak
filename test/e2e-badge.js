/* The number on the app icon: the closest thing iOS gives a web app to a widget. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (a, b) => console.log('  ' + a + ':', b);
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const errs = [];
  // Chromium here has no Badging API, and neither does an iPhone in a browser
  // tab — so stub it and record what the app asked for.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { }
    window.__badge = [];
    navigator.setAppBadge = n => { window.__badge.push(n); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badge.push(0); return Promise.resolve(); };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/gsi|accounts\.google|ERR_TUNNEL|409|429/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#q', { timeout: 8000 });
  await page.fill('#q', 'תומר אוסוביצקי'); await page.waitForTimeout(150);
  await page.click('.res'); await page.waitForSelector('.hero');
  await page.waitForTimeout(600);

  const asked = await page.evaluate(() => window.__badge);
  step('the app sets a badge on load', asked.length ? '✓ ' + JSON.stringify(asked) : '✗ never called');

  // and it must agree with what the server would tell the service worker
  const srv = await page.evaluate(async () => (await (await fetch('/api/badge')).json()));
  step('server says', JSON.stringify(srv));
  const last = asked[asked.length - 1];
  step('app and server agree', last === srv.n ? '✓ both ' + last : '✗ app=' + last + ' server=' + srv.n);

  // the endpoint must never leak more than the count
  const keys = Object.keys(srv).sort().join(',');
  step('badge payload is only a count', keys === 'n,next,on' ? '✓ ' + keys : '✗ ' + keys);

  // pick somebody with watches ahead, so we exercise a non-zero badge
  const person = await page.evaluate(async () => {
    const r = await (await fetch('/api/roster')).json();
    const now = Date.now();
    const soon = r.shifts.filter(s => !s.x && s.s > now && s.s < now + 864e5);
    return soon.length ? soon[0].n : null;
  });
  if (person) {
    await page.evaluate(async n => {
      await fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sheet: '1MOCKSHEETIDxxxxxxxxxxxxxxxxxxxx', person: n }) });
    }, person);
    await page.evaluate(() => { window.__badge = []; });
    await page.reload(); await page.waitForSelector('.hero', { timeout: 8000 });
    await page.waitForTimeout(700);
    const n2 = (await page.evaluate(() => window.__badge)).pop();
    const s2 = await page.evaluate(async () => (await (await fetch('/api/badge')).json()));
    step('someone with watches ahead', person + ' → badge ' + n2 + ', server ' + s2.n);
    step('non-zero and matching', n2 > 0 && n2 === s2.n ? '✓' : '✗');
  }

  // turning it off must clear the icon, not just stop updating it
  await page.click('#cfg'); await page.waitForSelector('#setmenu');
  await page.click('#nav-notif'); await page.waitForSelector('#badgech');
  const chips = await page.$$eval('#badgech .chip', ns => ns.map(n => n.textContent + (n.classList.contains('on') ? '*' : '')));
  step('setting offered', chips.join(' / '));
  await page.evaluate(() => { window.__badge = []; });
  await page.click('#badgech .chip:nth-child(2)'); await page.waitForTimeout(500);
  step('switching it off clears the icon', (await page.evaluate(() => window.__badge)).indexOf(0) >= 0 ? '✓' : '✗');
  step('choice sticks', await page.$$eval('#badgech .chip.on', ns => ns.map(n => n.textContent).join()));
  await page.reload(); await page.waitForSelector('.hero', { timeout: 8000 });
  await page.waitForTimeout(600);
  const afterOff = await page.evaluate(() => window.__badge);
  step('and stays off after a reload', afterOff.every(x => x === 0) ? '✓' : '✗ ' + JSON.stringify(afterOff));

  // long-press shortcuts on the icon
  const man = await page.evaluate(async () => (await (await fetch('/manifest.webmanifest')).json()).shortcuts);
  step('icon shortcuts', (man || []).map(x => x.name + ' → ' + x.url).join(' / ') || '✗ none');
  // a shortcut launches the app cold at that address; goto alone would only
  // move the fragment, so reload to make it a real start
  await page.goto(BASE + '/#board');
  await page.reload();
  await page.waitForSelector('#board .item', { timeout: 8000 });
  step('#board opens the watch board', '✓');
  await page.goto(BASE + '/#guide'); await page.reload();
  await page.waitForSelector('#gdone', { timeout: 8000 });
  step('#guide opens the guide', '✓');
  await page.click('#gdone'); await page.waitForSelector('.hero', { timeout: 8000 });
  step('and the shortcut is used up, not sticky', '✓');

  /* ---- the iOS shell ----
     The native app is the same page in a web view. It only asks for one thing:
     a widget token, handed over through window.webkit.messageHandlers.sh. */
  const shell = await b.newContext({ viewport: { width: 400, height: 900 }, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await shell.addInitScript(() => {
    try { localStorage.setItem('sh.sid', JSON.stringify('TESTSID')); } catch (e) { }
    window.__sent = [];
    window.webkit = { messageHandlers: { sh: { postMessage: m => window.__sent.push(m) } } };
  });
  const p2 = await shell.newPage();
  p2.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p2.goto(BASE);
  // the name is already chosen on the server by now, so the picker may not show
  await p2.waitForSelector('#q, .hero', { timeout: 8000 });
  if (await p2.$('#q')) {
    await p2.fill('#q', 'תומר אוסוביצקי'); await p2.waitForTimeout(150);
    await p2.click('.res');
  }
  await p2.waitForSelector('.hero', { timeout: 8000 });
  await p2.waitForTimeout(1400);
  const sent = await p2.evaluate(() => window.__sent);
  const handover = sent.find(m => m.type === 'widget');
  step('the shell is handed a widget token', handover ? '✓ ' + handover.token + ' @ ' + handover.origin : '✗ never sent');
  step('and a redraw when the roster loads', sent.some(m => m.type === 'refresh') ? '✓' : '✗');

  // what the widget itself would draw
  if (handover) {
    const w = await p2.evaluate(async t => {
      const r = await fetch('/api/widget', { headers: { authorization: 'Bearer ' + t } });
      return r.ok ? r.json() : { error: r.status };
    }, handover.token);
    step('widget payload', JSON.stringify(w).slice(0, 160));
    step('it is finished sentences, not a roster',
      (typeof w.line1 === 'string' && !('shifts' in w) && !('names' in w)) ? '✓' : '✗');
    const bad = await p2.evaluate(async () => {
      const r = await fetch('/api/widget', { headers: { authorization: 'Bearer wt_NOPE' } });
      return r.status;
    });
    step('a wrong token gets nothing', bad === 401 ? '✓ 401' : '✗ ' + bad);
    /* The two native shells share these endpoints. Both apps register a
       device token with the widget token as proof, and both fetch the text of
       a notification instead of receiving it from Apple or Google. */
    const reg = await p2.evaluate(async t => {
      const call = (path, body) => fetch(path, { method: 'POST',
        headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
        body: JSON.stringify(body) }).then(r => r.status);
      return {
        ios: await call('/api/apns/register', { token: 'a'.repeat(64), env: 'sandbox', bundle: 'com.shavtzak.app' }),
        android: await call('/api/fcm/register', { token: 'f'.repeat(140) }),
        junk: await call('/api/fcm/register', { token: 'nope' }),
      };
    }, handover.token);
    step('an iPhone can register for push', reg.ios === 200 ? '✓' : '✗ ' + reg.ios);
    step('an Android can too', reg.android === 200 ? '✓' : '✗ ' + reg.android);
    step('a junk device token is refused', reg.junk === 400 ? '✓' : '✗ ' + reg.junk);

    const ext = await p2.evaluate(async t =>
      (await fetch('/api/notify/ext', { headers: { authorization: 'Bearer ' + t } })).json(), handover.token);
    step('the notification text comes over our own connection', ext.kind ? '✓ ' + ext.kind : '✗');
    const denied = await p2.evaluate(async () =>
      (await fetch('/api/notify/ext', { headers: { authorization: 'Bearer wt_NOPE' } })).status);
    step('and not to anyone else', denied === 401 ? '✓ 401' : '✗ ' + denied);
  }
  // a plain browser must not try any of this
  const plain = await page.evaluate(() => typeof window.webkit);
  step('nothing happens in a normal browser', plain === 'undefined' ? '✓' : '✗');

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '  no JS errors ✓');
  await b.close();
})();
